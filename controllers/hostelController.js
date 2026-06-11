const Hostel = require("../models/Hostel");
const Room = require("../models/Room");
const {
  cleanEmail,
  cleanText,
  firstValidationError,
  validateAddress,
  validateEmail,
  validateHostelName,
} = require("../utils/validation");

function parseArrayValue(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  if (typeof value === "string") return value.split(",").map(cleanText).filter(Boolean);
  return undefined;
}

function formatImage(image) {
  if (!image || !image.data) return null;
  return {
    _id: image._id,
    filename: image.filename,
    contentType: image.contentType,
    uploadedAt: image.uploadedAt,
    url: `data:${image.contentType};base64,${image.data.toString("base64")}`,
  };
}

function getHostelImageUrls(hostel) {
  const fileImages = (hostel.imageFiles || []).map(formatImage).filter(Boolean);
  const urlImages = hostel.images || [];
  return [...fileImages.map((img) => img.url), ...urlImages];
}

function getThumbnail(hostel) {
  const firstFileImage = (hostel.imageFiles || [])[0];
  if (firstFileImage) return formatImage(firstFileImage).url;
  return (hostel.images || [])[0] || null;
}

function buildHostelResponse(hostel, stats = {}) {
  return {
    _id: hostel._id,
    name: hostel.name,
    description: hostel.description,
    address: hostel.address,
    contactEmail: hostel.contactEmail,
    contactPhone: hostel.contactPhone,
    facilities: hostel.facilities,
    rules: hostel.rules || [],
    owner: hostel.owner,
    roomCount: stats.roomCount || 0,
    availableRooms: stats.availableRooms || 0,
    freeSeats: stats.freeSeats || 0,
    roomTypes: stats.roomTypes || [],
    minPrice: stats.minPrice || 0,
    maxPrice: stats.maxPrice || 0,
    priceRange:
      stats.roomCount > 0
        ? `Rs.${stats.minPrice.toLocaleString()} - Rs.${stats.maxPrice.toLocaleString()}`
        : "No rooms listed yet",
    thumbnail: getThumbnail(hostel),
  };
}

exports.getHostel = async (req, res) => {
  try {
    if (!req.user?.hostel) {
      return res.status(404).json({ message: "Hostel not found" });
    }

    const hostel = await Hostel.findById(req.user.hostel).populate("owner", "fullName email");
    if (!hostel) return res.status(404).json({ message: "Hostel not found" });

    const response = {
      ...hostel.toObject(),
      images: getHostelImageUrls(hostel),
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateHostel = async (req, res) => {
  try {
    const {
      name,
      description,
      address,
      contactEmail,
      contactPhone,
      facilities,
      rules,
      images,
    } = req.body;

    const validationError = firstValidationError([
      name !== undefined ? validateHostelName(name) : "",
      contactEmail !== undefined ? validateEmail(contactEmail) : "",
      address !== undefined ? validateAddress(address, "Hostel address") : "",
    ]);

    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const facilityArray = parseArrayValue(facilities);
    const ruleArray = parseArrayValue(rules);
    const imageArray = parseArrayValue(images);

    let hostel = await Hostel.findOne({ owner: req.user._id });
    if (!hostel && req.user.hostel) {
      hostel = await Hostel.findById(req.user.hostel);
    }

    if (!hostel) {
      hostel = await Hostel.create({
        owner: req.user._id,
        name: cleanText(name),
        description: cleanText(description),
        address: cleanText(address),
        contactEmail: contactEmail ? cleanEmail(contactEmail) : undefined,
        contactPhone: contactPhone ? cleanText(contactPhone) : undefined,
        facilities: facilityArray || [],
        rules: ruleArray || [],
        images: imageArray || [],
      });
      req.user.hostel = hostel._id;
      await req.user.save();
      return res.status(201).json({
        ...hostel.toObject(),
        images: getHostelImageUrls(hostel),
      });
    }

    if (name !== undefined) hostel.name = cleanText(name);
    if (description !== undefined) hostel.description = cleanText(description);
    if (address !== undefined) hostel.address = cleanText(address);
    if (contactEmail !== undefined) hostel.contactEmail = cleanEmail(contactEmail);
    if (contactPhone !== undefined) hostel.contactPhone = cleanText(contactPhone);
    if (facilityArray !== undefined) hostel.facilities = facilityArray;
    if (ruleArray !== undefined) hostel.rules = ruleArray;
    if (imageArray !== undefined) hostel.images = imageArray;

    await hostel.save();

    res.json({
      ...hostel.toObject(),
      images: getHostelImageUrls(hostel),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.uploadHostelImages = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "No image files were uploaded." });
    }

    if (!req.user?.hostel) {
      return res.status(404).json({ message: "Hostel not found" });
    }

    const hostel = await Hostel.findById(req.user.hostel);
    if (!hostel) return res.status(404).json({ message: "Hostel not found" });

    const newImages = req.files.map((file) => ({
      filename: file.originalname,
      contentType: file.mimetype,
      data: file.buffer,
      uploadedAt: new Date(),
    }));

    hostel.imageFiles = [...(hostel.imageFiles || []), ...newImages];
    await hostel.save();

    res.json({
      ...hostel.toObject(),
      images: getHostelImageUrls(hostel),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteHostelImage = async (req, res) => {
  try {
    if (!req.user?.hostel) {
      return res.status(404).json({ message: "Hostel not found" });
    }

    const hostel = await Hostel.findById(req.user.hostel);
    if (!hostel) return res.status(404).json({ message: "Hostel not found" });

    const image = hostel.imageFiles.id(req.params.imageId);
    if (!image) {
      return res.status(404).json({ message: "Image not found" });
    }

    image.remove();
    await hostel.save();

    res.json({
      ...hostel.toObject(),
      images: getHostelImageUrls(hostel),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getHostels = async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const location = String(req.query.location || "").trim();
    const facility = String(req.query.facility || "").trim();
    const roomType = req.query.roomType ? Number(req.query.roomType) : null;
    const minPrice = req.query.minPrice ? Number(req.query.minPrice) : null;
    const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : null;

    const hostelFilter = {};
    if (search) {
      hostelFilter.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { address: { $regex: search, $options: "i" } },
      ];
    }
    if (location) {
      hostelFilter.address = { $regex: location, $options: "i" };
    }
    if (facility) {
      hostelFilter.facilities = {
        $in: facility.split(",").map((item) => item.trim()).filter(Boolean),
      };
    }

    const hostels = await Hostel.find(hostelFilter).populate("owner", "fullName").sort({ createdAt: -1 });
    const hostelIds = hostels.map((hostel) => hostel._id);

    const roomGroups = await Room.aggregate([
      { $match: { hostel: { $in: hostelIds } } },
      {
        $group: {
          _id: "$hostel",
          roomCount: { $sum: 1 },
          minPrice: { $min: "$monthlyFee" },
          maxPrice: { $max: "$monthlyFee" },
          availableRooms: {
            $sum: {
              $cond: [{ $eq: ["$status", "Available"] }, 1, 0],
            },
          },
          freeSeats: {
            $sum: { $max: [{ $subtract: ["$totalSeats", "$occupiedSeats"] }, 0] },
          },
          roomTypes: { $addToSet: "$seaterType" },
        },
      },
    ]);

    const roomStats = roomGroups.reduce((acc, item) => {
      acc[item._id.toString()] = item;
      return acc;
    }, {});

    const results = hostels
      .map((hostel) => {
        const stats = roomStats[hostel._id.toString()] || {};
        return {
          ...buildHostelResponse(hostel, stats),
          facilities: hostel.facilities,
          description: hostel.description,
          location: hostel.address,
        };
      })
      .filter((hostel) => {
        if (roomType && !hostel.roomTypes.includes(roomType)) return false;
        if (minPrice !== null && hostel.maxPrice && hostel.maxPrice < minPrice) return false;
        if (maxPrice !== null && hostel.minPrice && hostel.minPrice > maxPrice) return false;
        return true;
      });

    res.json(results);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getHostelById = async (req, res) => {
  try {
    const hostel = await Hostel.findById(req.params.id).populate("owner", "fullName");
    if (!hostel) return res.status(404).json({ message: "Hostel not found" });

    const rooms = await Room.find({ hostel: hostel._id }).sort({ roomNumber: 1 });
    const availableRooms = rooms.filter((room) => room.status === "Available").length;
    const freeSeats = rooms.reduce(
      (sum, room) => sum + Math.max(room.totalSeats - room.occupiedSeats, 0),
      0
    );
    const roomTypes = Array.from(new Set(rooms.map((room) => room.seaterType))).sort((a, b) => a - b);

    res.json({
      _id: hostel._id,
      name: hostel.name,
      description: hostel.description,
      address: hostel.address,
      rules: hostel.rules || [],
      contactEmail: hostel.contactEmail,
      contactPhone: hostel.contactPhone,
      facilities: hostel.facilities,
      images: getHostelImageUrls(hostel),
      owner: hostel.owner,
      rooms,
      stats: {
        totalRooms: rooms.length,
        availableRooms,
        freeSeats,
        roomTypes,
        minPrice: rooms.length > 0 ? Math.min(...rooms.map((room) => room.monthlyFee)) : 0,
        maxPrice: rooms.length > 0 ? Math.max(...rooms.map((room) => room.monthlyFee)) : 0,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
