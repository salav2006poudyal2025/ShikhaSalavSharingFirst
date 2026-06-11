const Room = require("../models/Room");
const {
  buildAlternativeSuggestion,
  buildSqlEquivalent,
  getRoomAssistantCapabilities,
  parseRoomQuery,
  rankRooms,
} = require("../services/roomQueryService");
const {
  generateAssistantMessage,
  queryRoomsWithAiAgent,
} = require("../services/roomAiService");

// GET /api/rooms
exports.getRooms = async (req, res) => {
  try {
    const filter = {};
    if (req.query.hostelId) {
      filter.hostel = req.query.hostelId;
    }

    const rooms = await Room.find(filter)
      .populate("hostel", "name address")
      .sort({ roomNumber: 1 });
    res.json(rooms);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getRoomById = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id).populate(
      "hostel",
      "name address"
    );
    if (!room) return res.status(404).json({ message: "Room not found" });
    res.json(room);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

async function getRoomStats() {
  const [stats = {}] = await Room.aggregate([
    {
      $group: {
        _id: null,
        availableRooms: {
          $sum: { $cond: [{ $eq: ["$status", "Available"] }, 1, 0] },
        },
        fullRooms: {
          $sum: { $cond: [{ $eq: ["$status", "Full"] }, 1, 0] },
        },
        occupiedSeats: { $sum: "$occupiedSeats" },
        totalRooms: { $sum: 1 },
        totalSeats: { $sum: "$totalSeats" },
      },
    },
  ]);

  const seaterBreakdown = await Room.aggregate([
    {
      $group: {
        _id: "$seaterType",
        availableRooms: {
          $sum: { $cond: [{ $eq: ["$status", "Available"] }, 1, 0] },
        },
        rooms: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return {
    availableRooms: stats.availableRooms || 0,
    fullRooms: stats.fullRooms || 0,
    freeSeats: (stats.totalSeats || 0) - (stats.occupiedSeats || 0),
    occupiedSeats: stats.occupiedSeats || 0,
    seaterBreakdown: seaterBreakdown.map((item) => ({
      availableRooms: item.availableRooms,
      rooms: item.rooms,
      seaterType: item._id,
    })),
    totalRooms: stats.totalRooms || 0,
    totalSeats: stats.totalSeats || 0,
  };
}

function shouldUseAiAgent(parsed) {
  return (
    !parsed.countMode &&
    parsed.summary === "all rooms" &&
    !parsed.limit &&
    !parsed.sort
  );
}

// POST /api/rooms/query
exports.queryRooms = async (req, res) => {
  try {
    const { query } = req.body;

    if (!query || typeof query !== "string") {
      return res
        .status(400)
        .json({ message: "Please provide a natural language query." });
    }

    const parsed = parseRoomQuery(query);

    if (parsed.intent === "greeting") {
      return res.json({
        aiMessage:
          "Hello! Tell me what kind of room you want, like '2 seater rooms' or '10k to 15k rooms'.",
        bestRoom: null,
        count: 0,
        filter: {},
        query,
        rooms: [],
        sqlEquivalent: "No database search needed",
        summary: "Greeting",
      });
    }

    if (parsed.intent === "capabilities") {
      return res.json({
        aiMessage: getRoomAssistantCapabilities(),
        bestRoom: null,
        count: 0,
        filter: {},
        query,
        rooms: [],
        sqlEquivalent: "No database search needed",
        summary: "Assistant capabilities",
      });
    }

    if (parsed.intent === "roomStats") {
      const stats = await getRoomStats();

      return res.json({
        aiMessage: `There are ${stats.totalRooms} total room(s), ${stats.availableRooms} available and ${stats.fullRooms} full.`,
        bestRoom: null,
        count: stats.totalRooms,
        filter: {},
        query,
        rooms: [],
        sqlEquivalent: "SELECT COUNT(*), SUM(total_seats), SUM(occupied_seats) FROM rooms",
        stats,
        summary: "Total room statistics",
      });
    }

    if (shouldUseAiAgent(parsed)) {
      const aiResult = await queryRoomsWithAiAgent(query);
      if (aiResult) return res.json(aiResult);
    }

    if (req.query.hostelId) {
      parsed.filter.hostel = req.query.hostelId;
    }

    const mongoQuery = Room.find(parsed.filter);

    if (parsed.sort) mongoQuery.sort(parsed.sort);
    if (parsed.limit && !parsed.terms?.targetBudget && !parsed.terms?.preferMoreFreeSeats) {
      mongoQuery.limit(parsed.limit);
    }

    const rawRooms = await mongoQuery.exec();
    const rankedRooms = rankRooms(rawRooms, parsed);
    const rooms = parsed.limit ? rankedRooms.slice(0, parsed.limit) : rankedRooms;
    const count = await Room.countDocuments(parsed.filter);
    const sqlEquivalent = buildSqlEquivalent(parsed.filter, parsed.sort, parsed.limit);

    const response = {
      bestRoom: rooms[0] || null,
      count,
      filter: parsed.filter,
      query,
      rooms,
      sqlEquivalent,
      summary: parsed.summary,
    };

    const aiMessage = await generateAssistantMessage(
      query,
      parsed,
      rooms,
      sqlEquivalent
    );
    if (aiMessage) response.aiMessage = aiMessage;

    if (rooms.length === 0) {
      const alternative = await buildAlternativeSuggestion(parsed.filter);

      if (alternative) {
        response.message =
          "No exact matches found. Here is the closest available alternative.";
        response.suggestedRoom = alternative;
      } else {
        response.message =
          "No rooms match that request and no available alternatives are currently open.";
      }
    } else if (parsed.countMode) {
      response.message = `Found ${count} matching room${count === 1 ? "" : "s"}.`;
    } else if (parsed.wantBestMatch) {
      response.message = "Showing the strongest room matches based on your request.";
    } else {
      response.message = `Found ${rooms.length} room${rooms.length === 1 ? "" : "s"} matching your query.`;
    }

    res.json(response);
  } catch (error) {
    console.error("Query Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// POST /api/rooms
exports.createRoom = async (req, res) => {
  try {
    const { roomNumber, seaterType, monthlyFee, description, images } = req.body;

    if (!roomNumber || !seaterType || !monthlyFee) {
      return res.status(400).json({
        message: "Room number, seater type and monthly fee are required",
      });
    }

    if (!req.user?.hostel) {
      return res.status(400).json({ message: "Please configure a hostel first." });
    }

    const numericRoomNumber = Number(roomNumber);
    if (Number.isNaN(numericRoomNumber) || numericRoomNumber < 1) {
      return res
        .status(400)
        .json({ message: "Room number must be a positive number" });
    }

    const numericMonthlyFee = Number(monthlyFee);
    if (Number.isNaN(numericMonthlyFee) || numericMonthlyFee < 0) {
      return res
        .status(400)
        .json({ message: "Monthly fee must be a non-negative number" });
    }

    const numericSeaterType = Number(seaterType);
    if (![2, 3, 4].includes(numericSeaterType)) {
      return res
        .status(400)
        .json({ message: "Seater type must be 2, 3, or 4" });
    }

    const exists = await Room.findOne({
      hostel: req.user.hostel,
      roomNumber: numericRoomNumber,
    });
    if (exists) {
      return res.status(400).json({ message: "Room number already exists" });
    }

    const room = await Room.create({
      hostel: req.user.hostel,
      monthlyFee: numericMonthlyFee,
      roomNumber: numericRoomNumber,
      seaterType: numericSeaterType,
      totalSeats: numericSeaterType,
      description: description ? String(description).trim() : "",
      images: Array.isArray(images) ? images : [],
    });

    res.status(201).json(room);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// PUT /api/rooms/:id
exports.updateRoom = async (req, res) => {
  try {
    const { monthlyFee } = req.body;
    const room = await Room.findById(req.params.id);

    if (!room) return res.status(404).json({ message: "Room not found" });
    if (!req.user?.hostel || room.hostel.toString() !== req.user.hostel.toString()) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (monthlyFee !== undefined) {
      const numericMonthlyFee = Number(monthlyFee);
      if (Number.isNaN(numericMonthlyFee) || numericMonthlyFee < 0) {
        return res
          .status(400)
          .json({ message: "Monthly fee must be a non-negative number" });
      }
      room.monthlyFee = numericMonthlyFee;
    }

    await room.save();
    res.json(room);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// DELETE /api/rooms/:id
exports.deleteRoom = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ message: "Room not found" });
    if (!req.user?.hostel || room.hostel.toString() !== req.user.hostel.toString()) {
      return res.status(403).json({ message: "Access denied" });
    }
    if (room.occupiedSeats > 0) {
      return res
        .status(400)
        .json({ message: "Cannot delete a room with occupied seats" });
    }

    await room.deleteOne();
    res.json({ message: "Room deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
