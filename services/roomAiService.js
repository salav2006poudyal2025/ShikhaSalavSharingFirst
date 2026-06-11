const OpenAI = require("openai");

const Room = require("../models/Room");
const { getFreeSeats } = require("./roomQueryService");

const openAiKey = process.env.OPENAI_API_KEY;
const openAiModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
const openai = openAiKey ? new OpenAI({ apiKey: openAiKey }) : null;

function isQuotaError(error) {
  const errorMessage = error?.response?.data || error?.message || error;
  return String(errorMessage).includes("429");
}

function buildRoomSearchTool() {
  return {
    type: "function",
    function: {
      name: "search_database_for_rooms",
      description: "Search the hostel database for rooms matching specific criteria.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Maximum number of rooms to return. Default 5.",
          },
          maxPrice: {
            type: "number",
            description: "Maximum monthly fee",
          },
          minPrice: {
            type: "number",
            description: "Minimum monthly fee",
          },
          roomNumber: {
            type: "number",
            description: "Specific room number",
          },
          seaterType: {
            type: "number",
            description: "Number of seats in the room, for example 2, 3, or 4",
          },
          sortByFee: {
            type: "string",
            enum: ["asc", "desc"],
            description: "Sort by price, asc for cheapest or desc for most expensive",
          },
          status: {
            type: "string",
            enum: ["Available", "Full"],
            description: "Whether the room is available or full",
          },
        },
      },
    },
  };
}

function buildFilterFromToolArgs(args) {
  const filter = {};

  if (args.roomNumber) filter.roomNumber = args.roomNumber;
  if (args.seaterType) filter.seaterType = args.seaterType;
  if (args.status) filter.status = args.status;

  if (args.minPrice !== undefined || args.maxPrice !== undefined) {
    filter.monthlyFee = {};
    if (args.minPrice !== undefined) filter.monthlyFee.$gte = args.minPrice;
    if (args.maxPrice !== undefined) filter.monthlyFee.$lte = args.maxPrice;
  }

  return filter;
}

async function searchRoomsWithToolArgs(args) {
  const filter = buildFilterFromToolArgs(args);
  let mongoQuery = Room.find(filter);

  if (args.sortByFee === "asc") {
    mongoQuery = mongoQuery.sort({ monthlyFee: 1 });
  } else if (args.sortByFee === "desc") {
    mongoQuery = mongoQuery.sort({ monthlyFee: -1 });
  }

  return mongoQuery.limit(args.limit || 5).exec();
}

function addUniqueRooms(target, rooms) {
  rooms.forEach((room) => {
    const alreadyAdded = target.some(
      (existingRoom) => existingRoom._id.toString() === room._id.toString()
    );

    if (!alreadyAdded) target.push(room);
  });
}

function summarizeToolRooms(rooms) {
  if (!rooms.length) {
    return [
      "No matching rooms found.",
      "Try searching again with broader criteria such as removing seater type,",
      "adjusting price, or checking full rooms.",
    ].join(" ");
  }

  return rooms
    .map(
      (room) =>
        [
          `Room #${room.roomNumber}: ${room.seaterType}-seater`,
          `Rs.${room.monthlyFee}/mo`,
          `Status: ${room.status}`,
          `Free Seats: ${getFreeSeats(room)}`,
        ].join(", ")
    )
    .join("\n");
}

async function generateAssistantMessage(query, parsed, rooms, sqlEquivalent) {
  if (!openai) return null;

  const topRooms = rooms.slice(0, 5).map((room, index) => {
    return [
      `${index + 1}. Room #${room.roomNumber}`,
      `${room.seaterType}-Seater`,
      `Rs.${room.monthlyFee}/month`,
      `${getFreeSeats(room)} free seat(s)`,
      room.status,
    ].join(" - ");
  });

  const roomSummary = topRooms.length
    ? `Top matching rooms:\n${topRooms.join("\n")}`
    : "No matching rooms found.";

  const messages = [
    {
      role: "system",
      content: [
        "You are a concise room-search assistant for Shikha Girls Hostel.",
        "Use the parsed filters and room list as source of truth.",
        "Recommend practical options and mention room numbers, price, seat type, and free seats.",
        "If no exact match exists, suggest the closest available alternative.",
        "Do not invent rooms or policies.",
      ].join(" "),
    },
    {
      role: "user",
      content: [
        `User query: "${query}"`,
        `Parsed filters: ${JSON.stringify(parsed.filter)}`,
        `Query plan: ${sqlEquivalent}`,
        `Search summary: ${parsed.summary}`,
        roomSummary,
      ].join("\n\n"),
    },
  ];

  try {
    const response = await openai.chat.completions.create({
      max_tokens: 650,
      messages,
      model: openAiModel,
      temperature: 0.35,
    });

    return response?.choices?.[0]?.message?.content?.trim() || null;
  } catch (error) {
    if (!isQuotaError(error)) {
      console.error("OpenAI room query error:", error?.message || error);
    }

    return null;
  }
}

async function queryRoomsWithAiAgent(query) {
  if (!openai) return null;

  const messages = [
    {
      role: "system",
      content: [
        "You are an advanced, intelligent AI assistant for Shikha Girls Hostel.",
        "Your job is to help users find rooms.",
        "Always use the search_database_for_rooms tool to fetch data.",
        "If there are no exact matches, call the tool again with broader criteria.",
        "Be polite, concise, and highlight the room number, seater type, price, and free seats.",
      ].join(" "),
    },
    {
      role: "user",
      content: query,
    },
  ];

  const finalRooms = [];
  let finalAnswer = "";
  let iteration = 0;

  try {
    while (iteration < 3) {
      const response = await openai.chat.completions.create({
        messages,
        model: openAiModel,
        temperature: 0.2,
        tool_choice: "auto",
        tools: [buildRoomSearchTool()],
      });
      const responseMessage = response.choices[0].message;
      messages.push(responseMessage);

      if (!responseMessage.tool_calls?.length) {
        finalAnswer = responseMessage.content;
        break;
      }

      for (const toolCall of responseMessage.tool_calls) {
        if (toolCall.function.name !== "search_database_for_rooms") continue;

        const args = JSON.parse(toolCall.function.arguments);
        const rooms = await searchRoomsWithToolArgs(args);
        addUniqueRooms(finalRooms, rooms);

        messages.push({
          content: summarizeToolRooms(rooms),
          name: toolCall.function.name,
          role: "tool",
          tool_call_id: toolCall.id,
        });
      }

      iteration++;
    }

    if (!finalAnswer) {
      const finalResponse = await openai.chat.completions.create({
        messages,
        model: openAiModel,
      });
      finalAnswer = finalResponse.choices[0].message.content;
    }

    return {
      aiMessage: finalAnswer,
      bestRoom: finalRooms[0] || null,
      count: finalRooms.length,
      filter: { ai_agent_used: true },
      message: finalRooms.length
        ? `Found ${finalRooms.length} room(s) via AI Agent.`
        : "No exact matches found.",
      query,
      rooms: finalRooms.slice(0, 5),
      sqlEquivalent: "AI-managed database execution with function calling",
      summary: "Advanced AI agent search",
    };
  } catch (error) {
    if (!isQuotaError(error)) {
      console.error(
        "OpenAI Agent Error, falling back to regex logic:",
        error?.message || error
      );
    }

    return null;
  }
}

module.exports = {
  generateAssistantMessage,
  queryRoomsWithAiAgent,
};
