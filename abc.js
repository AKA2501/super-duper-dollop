/*Version Info
-----Version-1.1----
*/
const oracledb = require('oracledb');
const fs = require('fs');
const dbConfig = require('../dbconfig');
const serializeInputData = require('./input-serialise');

function convertToUnixTimeSeconds(time, travelDate) {
  const hours = parseInt(time.slice(0, 2));
  const minutes = parseInt(time.slice(2, 4));
  const period = time.slice(4);
  let adjustedHours = hours;

  if (period === 'P' && hours !== 12) {
    adjustedHours += 12;
  } else if (period === 'A' && hours === 12) {
    adjustedHours = 0;
  }

  const date = new Date(`${travelDate}T${String(adjustedHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`);
  return Math.floor(date.getTime() / 1000); // Return Unix time in seconds
}

async function rtdfetchData(travelDate, operIdScenario, tenant, jdata) {
  //let ambTime= Number(jdata.amb)*60;
  //let wcTime = Number(jdata.wc)*60;
  let serializedInputFile;
  const sqlQuery1 = `SELECT t.*,veh_start + (veh_end-veh_start)/2 AS BRK_START, veh_start + (veh_end-veh_start)/2+t.BRK_DURATION AS BRK_END FROM (
    SELECT s.segmentid, s.OPER_ID,
    CASE
      WHEN v.VEH_ID LIKE '%4'  AND s.oper_id <> 'TND' THEN 'RTD4'
      WHEN v.VEH_ID LIKE '%6'  AND s.oper_id <> 'TND' THEN 'RTD5'
      WHEN v.VEH_ID LIKE '%TA3'  AND s.oper_id = 'TND' THEN 'AMB3'
      WHEN v.VEH_ID LIKE '%TA5'  AND s.oper_id = 'TND' THEN 'AMB5'   
    ELSE 'TEST' END AS VEH_TYPE,
    a.GRIDLONG VEH_START_LONG, a.GRIDLAT VEH_START_LAT, b.GRIDLONG VEH_END_LONG, b.GRIDLAT VEH_END_LAT,
    ((s.travel_date - date '1970-01-01') * 86400) + START_TIME * 60 VEH_START, 
    ((s.travel_date - date '1970-01-01') * 86400) + end_time * 60 VEH_END, TO_CHAR(s.travel_date, 'DAY') AS DayOfWeek,
    CASE
      WHEN (end_time - start_time) > 659 THEN 90 * 60
      WHEN (end_time - start_time) BETWEEN 480 AND 659 THEN 60 * 60
      WHEN (end_time - start_time) BETWEEN 390 AND 479 THEN 30 * 60
      WHEN (end_time - start_time) < 389 THEN 0 END AS BRK_DURATION,
    s.S_LOCATION3 AS VELOCITY,
    s.E_LOCATION3 AS MAXTASK,
    SUBSTR(S.DESCR, instr(S.DESCR,'-')+1, 4) AS DESCR
    FROM itms_segment s, itms_vehicle v, ITMS_ALIAS a, itms_alias b
    WHERE s.travel_date = '` + travelDate + `' AND s.DISPOSITION = 'T' AND s.vehicleid = v.VEH_ID
    AND s.ALIAS_START = a.ALIAS AND s.ALIAS_END = b.alias
    AND (
          '${operIdScenario}' = 'ALL' AND s.oper_id IN ('TD', 'MTM', 'CERT')
          OR '${operIdScenario}' <> 'ALL' AND s.oper_id = '${operIdScenario}'
      )
    AND a.GRIDLAT < 41.02131682687648 AND a.GRIDLAT > 36.99837934364601
    AND a.GRIDLONG < -102.09014977365582 AND a.GRIDLONG > -109.07599744272679
    AND b.GRIDLAT < 41.02131682687648 AND b.GRIDLAT > 36.99837934364601
    AND b.GRIDLONG < -102.09014977365582 AND b.GRIDLONG > -109.07599744272679
  ) t
  `;


const sqlQuery2 = `SELECT t.RES_NUM , t.TRIPID,t.CLIENTID,t.RETURN_TRIP, -- t.START_TIME , t.END_TIME ,
NVL(
      CASE
          WHEN t.RETURN_TRIP = 'N' THEN NVL(c.SCHOOL_IN, 0)
          ELSE NVL(c.DISTRICT, 0)
      END,
      0
  ) AS PU_PERF_TIME,
  NVL(
      CASE
          WHEN t.RETURN_TRIP = 'N' THEN NVL(c.SCHOOL_OUT, 0)
          ELSE NVL(c.ROUTE_NO, 0)
      END,
      0
  ) AS DO_PERF_TIME,
t.NAME ||' '|| t.NAME2 ||'~'|| a.address1 || ' ' || a.address2 || ', ' || a.CITYTOWN || ', ' || a.STATEPRO AS PU_DESC, a.GRIDLONG AS PU_LONG, a.GRIDLAT AS PU_LAT,
t.NAME ||' '|| t.NAME2 ||'~'|| b.address1 || ' ' || b.address2 || ', ' || b.CITYTOWN || ', ' || b.STATEPRO AS DO_DESC, b.GRIDLONG AS DO_LONG, b.GRIDLAT AS DO_LAT,
((t.travel_date - date '1970-01-01') * 86400) + substr(t.PU_WINDOW,1,instr(t.PU_WINDOW,'-')-1)*60 AS PU_START,
((t.travel_date - date '1970-01-01') * 86400) + substr(t.PU_WINDOW,instr(t.PU_WINDOW,'-')+1)*60 AS PU_END,
((t.travel_date - date '1970-01-01') * 86400) + ( DECODE (NVL (t.DESIRED_END_TIME, 0), 0,  NVL(substr(t.pu_window,1,instr(t.pu_window,'-')-1), 0), t.DESIRED_END_TIME- 30))*60  AS DO_START,
((t.travel_date - DATE '1970-01-01') * 86400 + 
(CASE 
  WHEN NVL(t.DESIRED_END_TIME, 0) = 0 THEN 
      CASE 
          WHEN (NVL(substr(t.pu_window,1,instr(t.pu_window,'-')-1), 0) + (
              CASE 
    WHEN t.est_distance > 0.00 AND t.est_distance <= 3.99 THEN 30
    WHEN t.est_distance > 3.99 AND t.est_distance <= 8.00 THEN 45
    WHEN t.est_distance > 8.00 AND t.est_distance <= 13.00 THEN 60
    WHEN t.est_distance > 13.00 AND t.est_distance <= 17.00 THEN 75
    WHEN t.est_distance > 17.00 AND t.est_distance <= 22.00 THEN 90
    WHEN t.est_distance > 22.00 AND t.est_distance <= 28.00 THEN 105
    WHEN t.est_distance > 28.00 THEN 120
END
 
          ) - (TO_NUMBER(NVL(SUBSTR(t.pu_window, 1, INSTR(t.pu_window,'-')-1), 0)))) > 120
          THEN (TO_NUMBER(NVL(SUBSTR(t.pu_window, 1, INSTR(t.pu_window,'-')-1), 0)) + 120)
          ELSE NVL(substr(t.pu_window,1,instr(t.pu_window,'-')-1), 0) + (
     CASE 
    WHEN t.est_distance > 0.00 AND t.est_distance <= 3.99 THEN 30
    WHEN t.est_distance > 3.99 AND t.est_distance <= 8.00 THEN 45
    WHEN t.est_distance > 8.00 AND t.est_distance <= 13.00 THEN 60
    WHEN t.est_distance > 13.00 AND t.est_distance <= 17.00 THEN 75
    WHEN t.est_distance > 17.00 AND t.est_distance <= 22.00 THEN 90
    WHEN t.est_distance > 22.00 AND t.est_distance <= 28.00 THEN 105
    WHEN t.est_distance > 28.00 THEN 120
END
    )
      END
  ELSE t.DESIRED_END_TIME
END
)* 60
) AS DO_END,t.EST_DISTANCE,t.EST_TRAV_TIME,
CASE WHEN DEV.ITMS7_CHECKMOBILITY(t.MOBILITY_LIST, 'AMBL')='Y' THEN 'Y' ELSE 'N' END AS IS_AMBL,
CASE   WHEN  DEV.ITMS7_CHECKMOBILITY(t.MOBILITY_LIST, 'WC')= 'Y' OR
  DEV.ITMS7_CHECKMOBILITY(t.MOBILITY_LIST, 'PMD')='Y' OR
  DEV.ITMS7_CHECKMOBILITY(t.MOBILITY_LIST, 'XLW')='Y' OR
  DEV.ITMS7_CHECKMOBILITY(t.MOBILITY_LIST, 'AMBL')='Y' THEN 'Y' ELSE 'N' END AS IS_WC_TIME,
CASE  WHEN  DEV.ITMS7_CHECKMOBILITY(t.MOBILITY_LIST, 'WC')= 'Y' OR
  DEV.ITMS7_CHECKMOBILITY(t.MOBILITY_LIST, 'PMD')='Y' OR
  DEV.ITMS7_CHECKMOBILITY(t.MOBILITY_LIST, 'XLW')='Y' THEN 'Y' ELSE 'N' END AS IS_WC,
  DECODE (NVL(GRP_CNT_WC,0) + NVL(GRP_CNT_AMB,0),0,'N','Y')  AS ADDL_PSNGR, NVL(GRP_CNT_WC,0) AS ADDL_PSNGR_WC, NVL(GRP_CNT_AMB,0) AS ADDL_PSNGR_AMB, CASE WHEN t.TRIP_TYPE= 'GROC' THEN 'Y' ELSE 'N' END AS IS_GROCERY,CASE WHEN t.TRIP_TYPE= 'ADACERT' THEN 'Y' ELSE 'N' END AS IS_CERT,
  t.E_LOCATION2 AS EXT_TRIPID,a.CITYTOWN PU_CITYTOWN,b.CITYTOWN DO_CITYTOWN
FROM ITMS_TRIPS t, ITMS_ALIAS a, itms_alias b, ITMS_CLIENT c
where TRAVEL_DATE= '` + travelDate + `' 
AND  t.DISPOSITION ='T' AND trip_type <> 'BRK'  AND t.CLIENTID = c.CLIENTID
AND t.ALIAS_S = a.ALIAS AND t.ALIAS_E = b.alias AND a.GRIDLAT < 41.02131682687648 AND a.GRIDLAT > 36.99837934364601
  AND a.GRIDLONG < -102.09014977365582 AND a.GRIDLONG > -109.07599744272679
  AND b.GRIDLAT < 41.02131682687648 AND b.GRIDLAT > 36.99837934364601
  AND b.GRIDLONG < -102.09014977365582 AND b.GRIDLONG > -109.07599744272679
ORDER BY t.CLIENTID`;

  var vehicles = [];
  var shipments = [];
  let connection;

  try {
    connection = await oracledb.getConnection(dbConfig[tenant]);
    console.log('starting the data fetch');
    var result1 = await connection.execute(sqlQuery1);
    var rows1 = result1.rows;
    console.log("rows1.length is " + rows1.length);

    const peakTimes = [
      { start: convertToUnixTimeSeconds('0730A', travelDate), end: convertToUnixTimeSeconds('0930A', travelDate) },
      { start: convertToUnixTimeSeconds('0130P', travelDate), end: convertToUnixTimeSeconds('0330P', travelDate) }
    ];

    rows1.forEach((row) => {
      let capacity;
      const vehType = row[result1.metaData.findIndex((m) => m.name === "VEH_TYPE")];
      const operId = row[result1.metaData.findIndex((m) => m.name === "OPER_ID")];
      
      switch (vehType) {
        case 'RTD5':
          capacity = [8, 3, 10, 100];
          break;
        case 'RTD4':
          capacity = [4, 1, 5, 100];
          break;
        case 'AMB3':
          capacity = [3, 0, 3, 100];
          break;
        case 'AMB5':
          capacity = [5, 0, 5, 100];
          break;
      }
      const DayOfWeek=row[result1.metaData.findIndex((m) => m.name === "DAYOFWEEK")].trim().toUpperCase();
      let skills;
      switch (operId) {
        case 'TND':
          skills = [2101, 2102, 2103, 2104, 2201, 2202, 2301, 2302, 1200, 1300];
          break;
        case 'MTM':
          skills = [2101, 2102, 2103, 2104, 2201, 2202, 2301, 2302, 2303, 2304, 2305, 2306, 2401, 2402, 2403, 2404, 2405, 2406, 2407, 2408, 2409, 1200, 1300, 1100, 3000, 4000, 5000,8000];
          break;
        case 'TD':
          skills = [2101, 2102, 2103, 2104, 2201, 2202, 2301, 2302, 2303, 2304, 2305, 2306, 2401, 2402, 2403, 2404, 2405, 2406, 2407, 2408, 2409, 1200, 1300, 1100, 3000, 4000, 5000];
          break;
      }
      //console.log(DayOfWeek);

         if (DayOfWeek === "SATURDAY"){
         //console.log("Entered the case");
            skills.push(8000);
          }
          if (DayOfWeek === "SUNDAY"){ console.log("Entered the case");
            skills.push(8000);
          }

        if (vehType === 'RTD5') {
            skills.push(7000); 
            //console.log(`Added skill 9999 to RTD5 vehicle with operId ${operId}`);
        }
        const descr = row[result1.metaData.findIndex((m) => m.name === "DESCR")];
//console.log("DESCR value:", descr.value);

        if (descr === "CERT") {
    //console.log("found CERT", descr);
          skills.push(6000);
          //console.log("Updated skills array");
        }

      const brkStartIndex = result1.metaData.findIndex((m) => m.name === "BRK_START");
      const brkEndIndex = result1.metaData.findIndex((m) => m.name === "BRK_END");
      const brkStart = parseFloat(row[brkStartIndex]);
      const brkEnd = parseFloat(row[brkEndIndex]);
      const segStart = parseFloat(row[result1.metaData.findIndex((m) => m.name === "VEH_START")]);
      const segEnd = parseFloat(row[result1.metaData.findIndex((m) => m.name === "VEH_END")]);
      const service1 = row[result1.metaData.findIndex((m) => m.name === "BRK_DURATION")];
      const SegmentTimeRatio = (segEnd - segStart);
      let breakWindow = [];

      if ((segEnd - segStart) >= 23400) {
        breakWindow = [(segStart + Math.ceil(SegmentTimeRatio / 2) - Math.ceil(service1 / 2)), (segEnd - Math.ceil(SegmentTimeRatio / 2) + Math.ceil(service1 / 2))];
      } else {
        breakWindow = [brkStart, brkEnd];
      }

      // Check if the break window violates peak times (in seconds)
      let overlap = peakTimes.some(peak => (
        (breakWindow[0] >= peak.start && breakWindow[0] < peak.end) ||
        (breakWindow[1] > peak.start && breakWindow[1] <= peak.end) ||
        (breakWindow[0] <= peak.start && breakWindow[1] >= peak.end)
      ));

      if (overlap) {
        console.log('Break window overlaps with peak times');
        // Adjust the break window to avoid peak times
        for (const peak of peakTimes) {
          if (
            breakWindow[0] < peak.end && breakWindow[1] > peak.start
          ) {
            // Shift the break window to after the peak time
            let shiftAmount = peak.end - breakWindow[0];
            breakWindow = [breakWindow[0] + shiftAmount, breakWindow[1] + shiftAmount];
            console.log(`Break window shifted to avoid peak time: ${new Date(breakWindow[0] * 1000)} - ${new Date(breakWindow[1] * 1000)}`);
            break;
          }
        }
      }

      const velocity = parseFloat(row[result1.metaData.findIndex((m) => m.name === "VELOCITY")]);
      const maxtask = parseFloat(row[result1.metaData.findIndex((m) => m.name === "MAXTASK")]);
      console.log(velocity);
      console.log(maxtask);

      vehicles.push({
        id: Number(row[result1.metaData.findIndex((m) => m.name === "SEGMENTID")].replace('S', '')),
        start: [row[result1.metaData.findIndex((m) => m.name === "VEH_START_LONG")], row[result1.metaData.findIndex((m) => m.name === "VEH_START_LAT")]],
        description: row[result1.metaData.findIndex((m) => m.name === "OPER_ID")],
        skills: skills,
        capacity: capacity,
        speed_factor: velocity / 100,
        max_tasks: maxtask * 2,
        time_window: [row[result1.metaData.findIndex((m) => m.name === "VEH_START")], row[result1.metaData.findIndex((m) => m.name === "VEH_END")]],
      });

      // Remove breaks and end if operId is 'TND'
      if (operIdScenario !== 'TND') {
        vehicles[vehicles.length - 1].end = [row[result1.metaData.findIndex((m) => m.name === "VEH_END_LONG")], row[result1.metaData.findIndex((m) => m.name === "VEH_END_LAT")]];
        vehicles[vehicles.length - 1].breaks = [{
          id: Number(row[result1.metaData.findIndex((m) => m.name === "SEGMENTID")].replace('S', '')),
          max_load: [0, 0, 0, 0],
          time_windows: [breakWindow], // Final break window in Unix time (seconds)
          service: row[result1.metaData.findIndex((m) => m.name === "BRK_DURATION")]
        }];
      } else if (operId === 'TND' && maxtask !== 1) {
        vehicles[vehicles.length - 1].end = [row[result1.metaData.findIndex((m) => m.name === "VEH_END_LONG")], row[result1.metaData.findIndex((m) => m.name === "VEH_END_LAT")]];
      }
    });
  var result2;
  console.log(operIdScenario);
    result2 = await connection.execute(sqlQuery2);
	var rows2 = result2.rows;
  console.log("rows2.length is " + rows2.length);
  const staticTable = {
    '0-15': { '0-13': 2101, '0-5': 2201, '5-15': 2301, '15-99': 2401 },
    '15-30': { '0-13': 2102, '0-5': 2202, '5-15': 2302, '15-99': 2402 },
    '30-45': { '0-13': 2103, '5-15': 2303, '15-99': 2403 },
    '45-60': { '0-13': 2104, '5-15': 2304, '15-99': 2404 },
    '60-75': { '5-15': 2305, '15-99': 2405 },
    '75-90': { '5-15': 2306, '15-99': 2406 },
    '90-105': { '15-99': 2407 },
    '105-120': { '15-99': 2408 },
    '120-135': { '15-99': 2409 }
  };
  rows2.forEach((row) => 
    {
          let isWC = row[result2.metaData.findIndex((m) => m.name === "IS_WC")];
          let isWCtime=row[result2.metaData.findIndex((m)=> m.name === "IS_WC_TIME")];
          let isEsc = row[result2.metaData.findIndex((m) => m.name === "ADDL_PSNGR")]; 
          let escAmb = Number(row[result2.metaData.findIndex((m) => m.name === "ADDL_PSNGR_AMB")]); 
          let escWc = Number(row[result2.metaData.findIndex((m) => m.name === "ADDL_PSNGR_WC")]);
          let amountArray = isWC === 'Y' ? [0, 1, 2, 1] : [1, 0, 1, 1];
          if (isEsc === 'Y') {
            amountArray = [amountArray[0] + escAmb, amountArray[1] + escWc, amountArray[2] + escAmb + (2 * escWc), amountArray[3]];
        }
          let isGroc = row[result2.metaData.findIndex((m) => m.name === "IS_GROCERY")];
          let iscert = row[result2.metaData.findIndex((m) => m.name === "IS_CERT")];
          let puLAT = row[result2.metaData.findIndex( (m) => m.name === "PU_LAT" )];
          let doLAT = row[result2.metaData.findIndex( (m) => m.name === "DO_LAT" )];
          let puLON = row[result2.metaData.findIndex( (m) => m.name === "PU_LONG" )];
          let doLON = row[result2.metaData.findIndex( (m) => m.name === "DO_LONG" )];
          let aliass = row[result2.metaData.findIndex( (m) => m.name === "ALIAS_S" )];
          let aliase= row[result2.metaData.findIndex( (m) => m.name === "ALIAS_E" )];
          let estTime = row[result2.metaData.findIndex( (m) => m.name === "EST_TRAV_TIME" )];
          let estDistance = row[result2.metaData.findIndex( (m) => m.name === "EST_DISTANCE" )];
          let isPMD = row[result2.metaData.findIndex((m) => m.name === "IS_PMD")];
          let PUCITY = row[result2.metaData.findIndex((m) => m.name === "PU_CITYTOWN")];
          let DOCITY = row[result2.metaData.findIndex((m) => m.name === "DO_CITYTOWN")];
          let skillsarray=[];
          if (isGroc === 'Y'){
            skillsarray.push(4000);
            if(isWC === 'Y'){
              amountArray = [0, 1, 2, 100];
            }else{
              amountArray = [1, 0, 1, 100];
            }
          }
          //console.log("skills for cert being added");
          if (iscert === 'Y'){
            skillsarray.push(6000);
            
          }
          if (PUCITY === 'LONGMONT' || DOCITY === 'LONGMONT') {
              skillsarray.push(8000);
            }
          if (isPMD === 'Y'){
            skillsarray.push(7000);
          }
          //console.log("esttime",estTime);
          //console.log("estdistance",estDistance);
          const estTimeRange = Object.keys(staticTable).find(range => {
            const [min, max] = range.split('-').map(Number);
            return estTime >= min && estTime <= max;
          });
  
          if (estTimeRange) {
            for (const distanceRange in staticTable[estTimeRange]) {
              const [min, max] = distanceRange.split('-').map(Number);
              if (estDistance >= min && estDistance <= max) {
                skillsarray.push(staticTable[estTimeRange][distanceRange]);
              }
            }
          }
          
          if (puLAT > 39.842967 && doLAT > 39.842967) {
            skillsarray.push(1100);
            }
            if (puLON <= -104.717391 && puLON >= -105.236717 && doLON <= -104.717391 && doLON >= -105.236717) {
            skillsarray.push(1200, 1300);
            }
          let isambl=row[result2.metaData.findIndex( (m) => m.name === "IS_AMBL" )];
          let puserviceTime=Number(row[result2.metaData.findIndex( (m) => m.name === "PU_PERF_TIME" )]);
          let doserviceTime=Number(row[result2.metaData.findIndex( (m) => m.name === "DO_PERF_TIME" )]);
          if(isambl==='Y'){
            skillsarray.push(5000);
          }
          //let ext_id=String(row[result2.metaData.findIndex( (m) => m.name === "EXT_TRIPID" )].replace('X', ''));
         if (puserviceTime === 0) {
      if (doserviceTime === 0) {
          if (isambl === 'Y') {
              puserviceTime = 360;
              doserviceTime = 180;
          } else if (isWC === 'Y') {
              puserviceTime = 480;
              doserviceTime = 360;
          } else if (isWC === 'N') {
              puserviceTime = 240;
              doserviceTime = 120;
          }
      } else {
          if (isambl === 'Y') {
              puserviceTime = 360;
          } else if (isWC === 'Y') {
              puserviceTime = 480;
          } else if (isWC === 'N') {
              puserviceTime = 240;
          }
      }
  }
  if (doserviceTime === 0) {
      if (isambl === 'Y') {
          doserviceTime = 180;
      } else if (isWC === 'Y') {
          doserviceTime = 360;
      } else if (isWC === 'N') {
          doserviceTime = 120;
      }
  }   let buffer1=Number(jdata[0].amb);
      let buffer2=Number(jdata[0].wc);
      //console.log("The Buffer is",buffer)
  let totalcntpassenger=escAmb+escWc;
      const PUstartbuffer = buffer1*60;
      const PUendbuffer = buffer2*60;
      shipments.push({
        amount: amountArray,
        skills: skillsarray,
        pickup: {
          id: Number(row[result2.metaData.findIndex( (m) => m.name === "TRIPID" )].replace('T', '')),
          service: Number(puserviceTime+(puserviceTime*totalcntpassenger)),
          description: String(totalcntpassenger),
          location: [row[result2.metaData.findIndex( (m) => m.name === "PU_LONG" )], row[result2.metaData.findIndex( (m) => m.name === "PU_LAT" )]],
          ...(row[result2.metaData.findIndex((m) => m.name === "PU_START")] <= 0 ? {} : { time_windows: [[row[result2.metaData.findIndex((m) => m.name === "PU_START")]- PUstartbuffer, row[result2.metaData.findIndex((m) => m.name === "PU_END")]- PUendbuffer]] })
          //time_windows: [[row[result2.metaData.findIndex( (m) => m.name === "PU_START" )], row[result2.metaData.findIndex( (m) => m.name === "PU_END" )]]]
        },
        delivery: {
          id: Number(row[result2.metaData.findIndex( (m) => m.name === "TRIPID" )].replace('T','')),
          service: Number(doserviceTime+(doserviceTime*totalcntpassenger)),
          description: String(totalcntpassenger),
          location: [row[result2.metaData.findIndex( (m) => m.name === "DO_LONG" )], row[result2.metaData.findIndex( (m) => m.name === "DO_LAT" )]],
          ...(row[result2.metaData.findIndex((m) => m.name === "DO_START")] <= 0 ? {} : { time_windows: [[row[result2.metaData.findIndex((m) => m.name === "DO_START")], row[result2.metaData.findIndex((m) => m.name === "DO_END")]]] })
          //time_windows: [[row[result2.metaData.findIndex( (m) => m.name === "DO_START" )], row[result2.metaData.findIndex( (m) => m.name === "DO_END" )]]]
          
        }
      });
    });
      const options = { g: false };	  
      const jsonData ={vehicles,shipments,options};
       serializedInputFile = await serializeInputData(jsonData, operIdScenario, travelDate, tenant);
    console.log(`Serialized Input file created at: ${serializedInputFile}`);  } catch (error) {
    console.error('Error fetching data:', error);
throw error;
  } finally {
    // Release the OracleDB connection
    await connection.close();
    
  }
  return [rows1.length, rows2.length,serializedInputFile];
}

// Export the fetchData function
module.exports = rtdfetchData;
