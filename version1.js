
const oracledb = require('oracledb');
const fs = require('fs');
const path = require('path');
const dbConfig = require('../dbconfig');

function adjustSegmentForOverlaps(segment, trips, windowStart, windowEnd) {
    const { segStart, segEnd, segmentId } = segment;
  
    // Filter trips based on skills matching the segmentId
    const relatedTrips = trips.filter((trip) =>
      trip.skills && trip.skills.includes(Number(segmentId.replace('S', '')))
    );
  
    // Identify overlapping trips
    const startOverlaps = relatedTrips.filter(
      (trip) => trip.DO_END && trip.DO_END <= segStart && trip.DO_END >= windowStart
    );
    const endOverlaps = relatedTrips.filter(
      (trip) => trip.PU_START && trip.PU_START >= segEnd && trip.PU_START <= windowEnd
    );
  
    // Adjust start time and location based on latest DO_END
    if (startOverlaps.length > 0) {
      const latestDropoff = startOverlaps.reduce((latest, trip) =>
        trip.DO_END > latest.DO_END ? trip : latest
      );
      segment.segStart = latestDropoff.DO_END;
      segment.startLocation = [latestDropoff.DO_LONG, latestDropoff.DO_LAT];
    }
  
    // Adjust end time and location based on earliest PU_START
    if (endOverlaps.length > 0) {
      const earliestPickup = endOverlaps.reduce((earliest, trip) =>
        trip.PU_START < earliest.PU_START ? trip : earliest
      );
      segment.segEnd = earliestPickup.PU_START;
      segment.endLocation = [earliestPickup.PU_LONG, earliestPickup.PU_LAT];
    }
  
    // Ensure adjusted segment remains valid
    if (segment.segStart >= segment.segEnd) {
      console.warn(
        `Invalid adjusted segment times: start=${segment.segStart}, end=${segment.segEnd}`
      );
      return null; // Indicate invalid segment
    }
  
    return segment; // Return the adjusted segment
  }
  
  
async function rtdfetchData(travelDate, operIdScenario, tenant, jdata, requestTime) {
  const sqlQuery1 = `
    SELECT t.*,veh_start + (veh_end-veh_start)/2 AS BRK_START, veh_start + (veh_end-veh_start)/2+t.BRK_DURATION AS BRK_END FROM (
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
    WHERE s.travel_date = :travelDate AND s.DISPOSITION = 'T' AND s.vehicleid = v.VEH_ID
    AND s.ALIAS_START = a.ALIAS AND s.ALIAS_END = b.alias
    AND (
          '${operIdScenario}' = 'ALL' AND s.oper_id IN ('TD', 'MTM', 'CERT')
          OR '${operIdScenario}' <> 'ALL' AND s.oper_id = '${operIdScenario}'
      )
    AND a.GRIDLAT < 41.02131682687648 AND a.GRIDLAT > 36.99837934364601
    AND a.GRIDLONG < -102.09014977365582 AND a.GRIDLONG > -109.07599744272679
    AND b.GRIDLAT < 41.02131682687648 AND b.GRIDLAT > 36.99837934364601
    AND b.GRIDLONG < -102.09014977365582 AND b.GRIDLONG > -109.07599744272679
  ) t  `;
  
  const sqlQuery2 = `
    SELECT t.RES_NUM ,t.PU_STOP,t.DO_STOP ,t.TRIPID,t.RETURN_TRIP,
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
a.GRIDLONG AS PU_LONG, a.GRIDLAT AS PU_LAT,
b.GRIDLONG AS DO_LONG, b.GRIDLAT AS DO_LAT,
((t.travel_date - date '1970-01-01') * 86400) + substr(t.PU_WINDOW,1,instr(t.PU_WINDOW,'-')-1)*60 AS PU_START,
((t.travel_date - date '1970-01-01') * 86400) + substr(t.PU_WINDOW,instr(t.PU_WINDOW,'-')+1)*60 AS PU_END,
((t.travel_date - date '1970-01-01') * 86400) + 
( DECODE (NVL (t.DESIRED_END_TIME, 0), 0,  NVL(substr(t.pu_window,1,instr(t.pu_window,'-')-1), 0), t.DESIRED_END_TIME- 30))*60  AS DO_START,
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
where TRAVEL_DATE= :travelDate AND  t.DISPOSITION ='T' AND trip_type <> 'BRK'  AND t.CLIENTID = c.CLIENTID
AND t.ALIAS_S = a.ALIAS AND t.ALIAS_E = b.alias AND a.GRIDLAT < 41.02131682687648 AND a.GRIDLAT > 36.99837934364601
  AND a.GRIDLONG < -102.09014977365582 AND a.GRIDLONG > -109.07599744272679
  AND b.GRIDLAT < 41.02131682687648 AND b.GRIDLAT > 36.99837934364601
  AND b.GRIDLONG < -102.09014977365582 AND b.GRIDLONG > -109.07599744272679
ORDER BY t.RES_NUM,t.PU_STOP,t.DO_STOP  `;

  const vehicles = [];
  const shipments = [];
  let connection;

  // Helper to calculate the 3-hour time window
     function getTimeWindow(requestTime) {
  // Parse requestTime as UTC
  const requestUnix = new Date(requestTime).getTime() / 1000; // Convert to Unix time
  const start = requestUnix + 3600; // Add 1 hour (3600 seconds)
  const end = start + 3 * 3600; // Add 3 hours to the start
  console.log(`Scheduling Window: Start: ${start}, End: ${end}`);
  console.log(
    `Scheduling Window (UTC): Start: ${new Date(start * 1000).toISOString()}, End: ${new Date(end * 1000).toISOString()}`
  );
  return { start, end };
}

  try {
    connection = await oracledb.getConnection(dbConfig[tenant]);
    console.log(`Server Time: ${new Date().toISOString()}`);
    console.log(`Request Time: ${requestTime}`);

    const result1 = await connection.execute(sqlQuery1, { travelDate });
    const rows1 = result1.rows;
    console.log(`rows1.length: ${rows1.length}`);

    const result2 = await connection.execute(sqlQuery2, { travelDate });
    const rows2 = result2.rows;
    console.log(`rows2.length: ${rows2.length}`);

    const { start: windowStart, end: windowEnd } = getTimeWindow(requestTime);

    // Process trips
// Define counters for trip categories
const tripCategoryCounts = {
  RESHUFFLE_ELIGIBLE: 0,
  LOCKED_DUE_TO_EARLY_PICKUP: 0,
  LOCKED_DUE_TO_LATE_DROPOFF: 0,
  OUTSIDE_WINDOW: 0,
};

rows2.forEach((row, index) => {
  const tripIdIndex = result2.metaData.findIndex((m) => m.name === "TRIPID");
  const segmentIdIndex = result2.metaData.findIndex((m) => m.name === "RES_NUM");
  const puStartIndex = result2.metaData.findIndex((m) => m.name === "PU_START");
  const puEndIndex = result2.metaData.findIndex((m) => m.name === "PU_END");
  const doStartIndex = result2.metaData.findIndex((m) => m.name === "DO_START");
  const doEndIndex = result2.metaData.findIndex((m) => m.name === "DO_END");

  // Validate indices and fields
  if (tripIdIndex === -1 || puStartIndex === -1 || doEndIndex === -1) {
    console.error(`Missing required metadata indices for row ${index + 1}`);
    return;
  }

  const tripId = row[tripIdIndex];
  const segmentId = row[segmentIdIndex]; // Allow `null` segmentId
  const puStart = row[puStartIndex] !== null ? parseFloat(row[puStartIndex]) : null;
  const doEnd = row[doEndIndex] !== null ? parseFloat(row[doEndIndex]) : null;
  const puEnd = row[puEndIndex] !== null ? parseFloat(row[puStartIndex]) : null;
  const doStart = row[doStartIndex] !== null ? parseFloat(row[doEndIndex]) : null;

  if (!tripId || puStart === null || doEnd === null) {
    console.error(`Missing required fields in row ${index + 1}: ${JSON.stringify(row)}`);
    return;
  }

  let skillsArray = [];
  let tripType;

  // Time window filtering logic
  if (puStart < windowStart && doEnd > windowStart && doEnd <= windowEnd) {
    // Locked due to early pickup
    if (segmentId) skillsArray.push(Number(segmentId.replace('S', '')));
    tripType = 'LOCKED_DUE_TO_EARLY_PICKUP';
    tripCategoryCounts.LOCKED_DUE_TO_EARLY_PICKUP++;
  } else if (puStart >= windowStart && doEnd <= windowEnd) {
    // Reshuffle eligible
    tripType = 'RESHUFFLE_ELIGIBLE';
    tripCategoryCounts.RESHUFFLE_ELIGIBLE++;
  } else if (puStart >= windowStart && doEnd > windowEnd) {
    // Locked due to late dropoff
    if (segmentId) skillsArray.push(Number(segmentId.replace('S', '')));
    tripType = 'LOCKED_DUE_TO_LATE_DROPOFF';
    tripCategoryCounts.LOCKED_DUE_TO_LATE_DROPOFF++;
  } else {
    // Outside time window
    tripType = 'OUTSIDE_WINDOW';
    tripCategoryCounts.OUTSIDE_WINDOW++;
    return; // Exclude this trip
  }

  //console.log(`Trip ${tripId} categorized as: ${tripType}`);

  shipments.push({
    skills: segmentId && skillsArray.length > 0 ? skillsArray : [], // Include skills only for intercrossing trips
    pickup: {
      id: Number(tripId.replace('T', '')),
      service: Number(row[result2.metaData.findIndex((m) => m.name === "PU_PERF_TIME")]),
      location: [
        row[result2.metaData.findIndex((m) => m.name === "PU_LONG")],
        row[result2.metaData.findIndex((m) => m.name === "PU_LAT")],
      ],
      ...(puStart > 0 ? { time_windows: [[puStart,puEnd]] } : {}),
    },
    delivery: {
      id: Number(tripId.replace('T', '')),
      service: Number(row[result2.metaData.findIndex((m) => m.name === "DO_PERF_TIME")]),
      location: [
        row[result2.metaData.findIndex((m) => m.name === "DO_LONG")],
        row[result2.metaData.findIndex((m) => m.name === "DO_LAT")],
      ],
      ...(doEnd > 0 ? { time_windows: [[doStart,doEnd]] } : {}),
    },
  });
});

// Log the counts for each category
console.log('Trip Categorization Counts:');
console.log(`RESHUFFLE_ELIGIBLE: ${tripCategoryCounts.RESHUFFLE_ELIGIBLE}`);
console.log(`LOCKED_DUE_TO_EARLY_PICKUP: ${tripCategoryCounts.LOCKED_DUE_TO_EARLY_PICKUP}`);
console.log(`LOCKED_DUE_TO_LATE_DROPOFF: ${tripCategoryCounts.LOCKED_DUE_TO_LATE_DROPOFF}`);
console.log(`OUTSIDE_WINDOW: ${tripCategoryCounts.OUTSIDE_WINDOW}`);

// Initialize category counts
const vehicleCategoryCounts = {
  FULLY_WITHIN_WINDOW: 0,
  PARTIALLY_WITHIN_WINDOW: 0,
  OUTSIDE_WINDOW: 0,
};

// Process vehicles and categorize
rows1.forEach((row, index) => {
    const segmentIdIndex = result1.metaData.findIndex((m) => m.name === "SEGMENTID");
    const segStartIndex = result1.metaData.findIndex((m) => m.name === "VEH_START");
    const segEndIndex = result1.metaData.findIndex((m) => m.name === "VEH_END");
  
    if (segmentIdIndex === -1 || segStartIndex === -1 || segEndIndex === -1) {
      console.error(`Missing required metadata indices for vehicle row ${index + 1}`);
      return;
    }
  
    const segmentId = row[segmentIdIndex];
    let segStart = row[segStartIndex] !== null ? parseFloat(row[segStartIndex]) : null;
    let segEnd = row[segEndIndex] !== null ? parseFloat(row[segEndIndex]) : null;
  
    if (!segmentId || segStart === null || segEnd === null) {
      console.error(`Missing required fields in vehicle row ${index + 1}: ${JSON.stringify(row)}`);
      return;
    }
  
    // Prepare segment object
    let segment = {
      segmentId,
      segStart,
      segEnd,
      startLocation: [
        row[result1.metaData.findIndex((m) => m.name === "VEH_START_LONG")],
        row[result1.metaData.findIndex((m) => m.name === "VEH_START_LAT")],
      ],
      endLocation: [
        row[result1.metaData.findIndex((m) => m.name === "VEH_END_LONG")],
        row[result1.metaData.findIndex((m) => m.name === "VEH_END_LAT")],
      ],
    };
  
    // Adjust segment for overlaps
    segment = adjustSegmentForOverlaps(segment, rows2, windowStart, windowEnd);
  
    // If segment is invalid after adjustment, exclude it
    if (!segment) {
      console.warn(`Segment ${segmentId} excluded due to invalid adjusted times.`);
      return;
    }
  
    // Include the adjusted segment in vehicles array
    vehicles.push({
      id: Number(segment.segmentId.replace('S', '')),
      start: segment.startLocation,
      end: segment.endLocation,
      time_window: [segment.segStart, segment.segEnd],
    });
  });
  

// Log only the categorization summary
console.log('Vehicle Categorization Counts:', vehicleCategoryCounts);

    console.log('Vehicles and shipments processed for the time window');
  } catch (error) {
    console.error('Error fetching data:', error);
    throw error;
  } finally {
    if (connection) {
      await connection.close();
    }
  }

  const outputFile = 'inputtest.json';
  fs.writeFileSync(outputFile, JSON.stringify({ vehicles, shipments }, null, 2));
  console.log(`Output written to ${outputFile}`);
}

// Usage example
const args = process.argv.slice(2);
if (args.length < 5) {
  console.error('Usage: node rtdfetchData.js <travelDate> <operIdScenario> <tenant> <jdata> <requestTime>');
  process.exit(1);
}

const [travelDate, operIdScenario, tenant, jdataRaw, requestTime] = args;
const jdata = JSON.parse(jdataRaw);

// Execute the function
rtdfetchData(travelDate, operIdScenario, tenant, jdata, requestTime).catch((err) => {
  console.error('Failed to fetch data:', err);
  process.exit(1);
});
