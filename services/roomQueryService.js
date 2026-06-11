const Room = require("../models/Room");

function getFreeSeats(room) {
  return Math.max((room.totalSeats || 0) - (room.occupiedSeats || 0), 0);
}

function normalizeNumber(value) {
  if (typeof value !== "string") return value;
  return Number(value.replace(/,/g, "").trim());
}

function normalizeQuery(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\b(u|ur)\b/g, (match) => (match === "u" ? "you" : "your"))
    .replace(/[?!.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(\d+(?:\.\d+)?)\s*k\b/gi, (_, value) =>
      String(Number(value) * 1000)
    );
}

function getRoomAssistantCapabilities() {
  return [
    "I can help you search hostel rooms in simple language.",
    "Try: '2 seater rooms', '2 and 3 seater rooms', '10k to 15k rooms',",
    "'cheapest available room', 'rooms with free seats', 'total rooms',",
    "or 'room 101'.",
  ].join(" ");
}

function getConversationalIntent(query) {
  const hasSearchTerms =
    /\b(room|rooms|seater|seat|sharing|bed|price|rent|budget|available|free|full|occupied)\b/.test(query);

  if (
    /^(hi|hello|hey|namaste|good morning|good afternoon|good evening)\b/.test(query) &&
    !hasSearchTerms
  ) {
    return "greeting";
  }

  if (
    /^(help|commands|features)$/.test(query) ||
    /\b(what can you do|what things you can do)\b/.test(query) ||
    /\b(how can you help|how do i use)\b/.test(query)
  ) {
    return "capabilities";
  }

  if (
    /\b(total rooms?|rooms? total|how many rooms?|number of rooms?)\b/.test(query) &&
    !/\b(available|free|vacant|full|occupied|seater|sharing|bed|under|below|above|between|from|to|rs|npr)\b/.test(query)
  ) {
    return "roomStats";
  }

  return null;
}

function addSeaterFilter(filter, summary, seaters) {
  const validSeaters = [...new Set(seaters)]
    .map(Number)
    .filter((value) => [2, 3, 4].includes(value));

  if (!validSeaters.length) return;

  if (validSeaters.length === 1) {
    filter.seaterType = validSeaters[0];
    summary.push(`seaterType = ${validSeaters[0]}`);
    return;
  }

  filter.seaterType = { $in: validSeaters };
  summary.push(`seaterType IN (${validSeaters.join(", ")})`);
}

function applyFeeBound(filter, summary, operator, value) {
  if (Number.isNaN(value)) return;

  filter.monthlyFee = filter.monthlyFee || {};
  filter.monthlyFee[operator] = value;
  summary.push(`monthlyFee ${operator === "$lte" ? "<=" : ">="} ${value}`);
}

function buildSqlEquivalent(filter, sort, limit) {
  const clauses = [];

  if (filter.roomNumber !== undefined) {
    clauses.push(`room_number = ${filter.roomNumber}`);
  }

  if (filter.seaterType !== undefined) {
    if (filter.seaterType.$in) {
      clauses.push(`seater_type IN (${filter.seaterType.$in.join(", ")})`);
    } else {
      clauses.push(`seater_type = ${filter.seaterType}`);
    }
  }

  if (filter.status) {
    clauses.push(`status = '${filter.status}'`);
  }

  if (filter.monthlyFee) {
    const fee = filter.monthlyFee;

    if (fee.$gte !== undefined && fee.$lte !== undefined) {
      clauses.push(`monthly_fee BETWEEN ${fee.$gte} AND ${fee.$lte}`);
    } else if (fee.$gte !== undefined) {
      clauses.push(`monthly_fee >= ${fee.$gte}`);
    } else if (fee.$lte !== undefined) {
      clauses.push(`monthly_fee <= ${fee.$lte}`);
    }
  }

  let sql = "SELECT * FROM rooms";

  if (clauses.length) sql += ` WHERE ${clauses.join(" AND ")}`;
  if (sort?.monthlyFee === 1) sql += " ORDER BY monthly_fee ASC";
  if (sort?.monthlyFee === -1) sql += " ORDER BY monthly_fee DESC";
  if (sort?.roomNumber === 1) sql += " ORDER BY room_number ASC";
  if (limit) sql += ` LIMIT ${limit}`;

  return sql;
}

function parseRoomQuery(text) {
  const query = normalizeQuery(text);
  const intent = getConversationalIntent(query);

  const filter = {};
  const summary = [];
  const terms = {};
  let sort = null;
  let limit = null;
  let countMode = false;
  let wantBestMatch = false;

  if (intent === "roomStats") {
    countMode = true;
  }

  const roomNumberMatch = query.match(/(?:room|room no\.?|room number|#)\s*#?\s*(\d+)/);
  if (roomNumberMatch) {
    const roomNumber = normalizeNumber(roomNumberMatch[1]);

    if (!Number.isNaN(roomNumber)) {
      filter.roomNumber = roomNumber;
      summary.push(`roomNumber = ${roomNumber}`);
    }
  }

  const wordSeatMap = {
    double: 2,
    four: 4,
    quad: 4,
    three: 3,
    triple: 3,
    two: 2,
  };
  const multiSeaterMatch = query.match(
    /\b([234])\s*(?:,|\/|or|and|\s)\s*([234])(?:\s*(?:,|\/|or|and|\s)\s*([234]))?\s*[- ]?(?:seater|seat|sharing|bed|rooms?)\b/
  );
  const peopleSeaterMatch = query.match(/\b(?:for|room for)\s*([234])\s*(?:people|persons|girls|students)\b/);
  const wordSeatMatch = query.match(
    /\b(two|double|three|triple|four|quad)\s*[- ]?(?:seater|seat|sharing|bed)?\b/
  );
  const seaterMatch = query.match(/(\d+)\s*[-]?\s*(?:seater|seat|sharing|bed)/);

  if (multiSeaterMatch) {
    addSeaterFilter(filter, summary, multiSeaterMatch.slice(1).filter(Boolean));
  }

  const seater = seaterMatch
    ? normalizeNumber(seaterMatch[1])
    : peopleSeaterMatch
      ? normalizeNumber(peopleSeaterMatch[1])
      : wordSeatMap[wordSeatMatch?.[1]];

  if (!filter.seaterType && [2, 3, 4].includes(seater)) {
    addSeaterFilter(filter, summary, [seater]);
  }

  const priceRangeMatch = query.match(
    /(?:between|from|within|range)\s*(?:rs\.?|npr)?\s*([\d,]+)\s*(?:-|to|and)\s*(?:rs\.?|npr)?\s*([\d,]+)/
  );
  const priceDashRangeMatch = query.match(
    /(?:rs\.?|npr)?\s*([\d,]+)\s*(?:-|to)\s*(?:rs\.?|npr)?\s*([\d,]+)/
  );
  const loosePriceRangeMatch = query.match(
    /(?:price|rent|fee|budget)\D+([\d,]+)\D+([\d,]+)/
  );
  const rangeMatch = priceRangeMatch || priceDashRangeMatch || loosePriceRangeMatch;

  if (rangeMatch) {
    const min = normalizeNumber(rangeMatch[1]);
    const max = normalizeNumber(rangeMatch[2]);

    if (!Number.isNaN(min) && !Number.isNaN(max)) {
      filter.monthlyFee = {
        $gte: Math.min(min, max),
        $lte: Math.max(min, max),
      };
      terms.targetBudget = Math.round((min + max) / 2);
      summary.push(`monthlyFee BETWEEN ${filter.monthlyFee.$gte} AND ${filter.monthlyFee.$lte}`);
    }
  }

  const lteMatch = query.match(
    /(?:under|below|less than|up to|at most|maximum|max|budget under|budget below|<=?)\s*(?:rs\.?|npr)?\s*([\d,]+)/
  );
  const gteMatch = query.match(
    /(?:above|more than|greater than|minimum|min|at least|>=?)\s*(?:rs\.?|npr)?\s*([\d,]+)/
  );
  const exactPriceMatch = query.match(
    /(?:for|cost|price|rent|around|near|about|budget is|budget of)\s*(?:rs\.?|npr)?\s*([\d,]+)/
  );

  if (!filter.monthlyFee && lteMatch) {
    applyFeeBound(filter, summary, "$lte", normalizeNumber(lteMatch[1]));
  }

  if (!filter.monthlyFee && gteMatch) {
    applyFeeBound(filter, summary, "$gte", normalizeNumber(gteMatch[1]));
  }

  if (!filter.monthlyFee && exactPriceMatch) {
    const value = normalizeNumber(exactPriceMatch[1]);

    if (!Number.isNaN(value)) {
      const tolerance = Math.max(Math.round(value * 0.15), 1000);
      filter.monthlyFee = {
        $gte: Math.max(value - tolerance, 0),
        $lte: value + tolerance,
      };
      terms.targetBudget = value;
      summary.push(`monthlyFee near ${value}`);
    }
  }

  if (!filter.monthlyFee) {
    const allNumbers = [...query.matchAll(/([\d,]+)/g)].map((match) =>
      normalizeNumber(match[1])
    );
    const possiblePrice = allNumbers.find(
      (number) =>
        !Number.isNaN(number) &&
        number >= 1000 &&
        number !== filter.roomNumber
    );

    if (possiblePrice) {
      const tolerance = Math.max(Math.round(possiblePrice * 0.15), 1000);
      filter.monthlyFee = {
        $gte: Math.max(possiblePrice - tolerance, 0),
        $lte: possiblePrice + tolerance,
      };
      terms.targetBudget = possiblePrice;
      summary.push(`monthlyFee near ${possiblePrice}`);
    }
  }

  if (/available|free|vacant|open|empty|seat left|space|not full/.test(query)) {
    filter.status = "Available";
    summary.push("status = Available");
  } else if (/full|occupied/.test(query)) {
    filter.status = "Full";
    summary.push("status = Full");
  }

  if (/free seat|most space|least crowded|less crowded|more seats|maximum seats|most available/.test(query)) {
    terms.preferMoreFreeSeats = true;
    wantBestMatch = true;
  }

  if (/cheapest|lowest|affordable|budget|best.*price/.test(query)) {
    sort = { monthlyFee: 1 };
    limit = 1;
    wantBestMatch = true;
  }

  if (/expensive|premium|highest/.test(query)) {
    sort = { monthlyFee: -1 };
    terms.preferExpensive = true;
    limit = limit || 1;
    wantBestMatch = true;
  }

  if (/suggest|recommend|best room|best match|i want|looking for|need.*room|find.*room/.test(query)) {
    sort = sort || { monthlyFee: 1 };
    limit = limit || 5;
    wantBestMatch = true;
  }

  if (/all rooms|list rooms|show rooms|show all/.test(query)) {
    sort = sort || { roomNumber: 1 };
  }

  if (/how many|count|number of|total/.test(query)) {
    countMode = true;
  }

  const limitMatch = query.match(/(?:top|show|list|give me)\s*(\d+)/);
  if (limitMatch) {
    limit = Math.min(Math.max(normalizeNumber(limitMatch[1]), 1), 20);
  }

  return {
    countMode,
    filter,
    intent,
    limit,
    sort,
    summary: summary.length ? summary.join(" AND ") : "all rooms",
    terms,
    wantBestMatch,
  };
}

async function buildAlternativeSuggestion(baseFilter) {
  const relaxed = { ...baseFilter, status: "Available" };
  delete relaxed.monthlyFee;
  delete relaxed.roomNumber;

  const candidates = await Room.find(relaxed).sort({ monthlyFee: 1 }).limit(10);
  if (candidates.length) return candidates[0];

  const fallback = await Room.find({ status: "Available" })
    .sort({ monthlyFee: 1 })
    .limit(1);
  return fallback[0] || null;
}

function rankRooms(rooms, parsed) {
  const terms = parsed.terms || {};

  return [...rooms].sort((a, b) => {
    const availableScore =
      Number(b.status === "Available") - Number(a.status === "Available");
    if (availableScore) return availableScore;

    if (terms.preferMoreFreeSeats) {
      const freeDiff = getFreeSeats(b) - getFreeSeats(a);
      if (freeDiff) return freeDiff;
    }

    if (terms.targetBudget) {
      const aDistance = Math.abs((a.monthlyFee || 0) - terms.targetBudget);
      const bDistance = Math.abs((b.monthlyFee || 0) - terms.targetBudget);
      if (aDistance !== bDistance) return aDistance - bDistance;
    }

    if (terms.preferExpensive) {
      return (b.monthlyFee || 0) - (a.monthlyFee || 0);
    }

    return (a.monthlyFee || 0) - (b.monthlyFee || 0);
  });
}

module.exports = {
  buildAlternativeSuggestion,
  buildSqlEquivalent,
  getRoomAssistantCapabilities,
  getFreeSeats,
  parseRoomQuery,
  rankRooms,
};
