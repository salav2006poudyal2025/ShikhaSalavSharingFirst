const User = require("../models/User");
const bcrypt = require("bcryptjs");
const {
  cleanEmail,
  cleanText,
  firstValidationError,
  validateEmail,
  validateName,
  validatePassword,
  validatePhone,
} = require("../utils/validation");

// POST /api/owner/wardens
exports.createWarden = async (req, res) => {
  try {
    const { fullName, email, phone, password } = req.body;
    const fullNameClean = cleanText(fullName);
    const emailClean = cleanEmail(email);
    const validationError = firstValidationError([
      validateName(fullNameClean),
      validateEmail(emailClean),
      phone ? validatePhone(phone) : "",
      validatePassword(password),
    ]);

    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const exists = await User.findOne({ email: emailClean });
    if (exists) return res.status(400).json({ message: "Email already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const warden = await User.create({
      fullName: fullNameClean,
      email: emailClean,
      phone: cleanText(phone),
      password: hashed,
      role: "Warden",
      hostel: req.user.hostel,
    });

    res.status(201).json({
      _id: warden._id,
      fullName: warden.fullName,
      email: warden.email,
      phone: warden.phone,
      role: warden.role,
      createdAt: warden.createdAt,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/owner/wardens
exports.getWardens = async (req, res) => {
  try {
    const wardens = await User.find({ role: "Warden", hostel: req.user.hostel })
      .select("-password")
      .sort({ createdAt: -1 });
    res.json(wardens);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/owner/wardens/:id
exports.updateWarden = async (req, res) => {
  try {
    const { fullName, email, phone, password } = req.body;
    const warden = await User.findOne({
      _id: req.params.id,
      role: "Warden",
      hostel: req.user.hostel,
    });

    if (!warden) return res.status(404).json({ message: "Warden not found" });

    const fullNameClean = fullName !== undefined ? cleanText(fullName) : undefined;
    const emailClean = email !== undefined ? cleanEmail(email) : undefined;
    const validationError = firstValidationError([
      fullNameClean !== undefined ? validateName(fullNameClean) : "",
      emailClean !== undefined ? validateEmail(emailClean) : "",
      phone ? validatePhone(phone) : "",
      password ? validatePassword(password) : "",
    ]);

    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    if (emailClean && emailClean !== warden.email) {
      const exists = await User.findOne({ email: emailClean, _id: { $ne: warden._id } });
      if (exists) return res.status(400).json({ message: "Email already exists" });
    }

    if (fullNameClean) warden.fullName = fullNameClean;
    if (emailClean) warden.email = emailClean;
    if (phone !== undefined) warden.phone = cleanText(phone);
    if (password) warden.password = await bcrypt.hash(password, 10);

    await warden.save();

    res.json({
      _id: warden._id,
      fullName: warden.fullName,
      email: warden.email,
      phone: warden.phone,
      role: warden.role,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE /api/owner/wardens/:id
exports.deleteWarden = async (req, res) => {
  try {
    const warden = await User.findOne({
      _id: req.params.id,
      role: "Warden",
      hostel: req.user.hostel,
    });
    if (!warden) return res.status(404).json({ message: "Warden not found" });

    await warden.deleteOne();
    res.json({ message: "Warden deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
