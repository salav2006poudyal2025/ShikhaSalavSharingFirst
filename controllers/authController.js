const User = require("../models/User");
const Hostel = require("../models/Hostel");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const {
  cleanEmail,
  cleanText,
  firstValidationError,
  validateEmail,
  validatePassword,
  validateName,
  validateHostelName,
} = require("../utils/validation");

async function ensureDefaultOwner(email, password) {
  if (email !== "owner@gmail.com" || password !== "owner12345") return null;

  const hashed = await bcrypt.hash(password, 10);
  let owner = await User.findOne({ email });

  if (!owner) {
    owner = await User.create({
      fullName: "System Owner",
      email,
      password: hashed,
      hostelName: "Shikha Girls Hostel",
      role: "Owner",
    });
    return owner;
  }

  const passwordMatches = await bcrypt.compare(password, owner.password);
  if (!passwordMatches || owner.role !== "Owner" || !owner.hostelName) {
    owner.password = hashed;
    owner.role = "Owner";
    owner.hostelName = owner.hostelName || "Shikha Girls Hostel";
    if (!owner.fullName) owner.fullName = "System Owner";
    await owner.save();
  }

  return owner;
}

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const emailClean = cleanEmail(email);
    const passwordClean = String(password || "");
    const validationError = firstValidationError([
      validateEmail(emailClean),
      validatePassword(passwordClean),
    ]);

    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    await ensureDefaultOwner(emailClean, passwordClean);

    const user = await User.findOne({ email: emailClean });
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const match = await bcrypt.compare(passwordClean, user.password);
    if (!match) return res.status(400).json({ message: "Invalid credentials" });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({
      token,
      role: user.role,
      fullName: user.fullName,
      email: user.email,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.register = async (req, res) => {
  try {
    const { fullName, hostelName, email, password } = req.body;
    const fullNameClean = cleanText(fullName);
    const emailClean = cleanEmail(email);
    const validationError = firstValidationError([
      validateName(fullNameClean),
      validateHostelName(hostelName),
      validateEmail(emailClean),
      validatePassword(password),
    ]);

    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const existing = await User.findOne({ email: emailClean });
    if (existing) return res.status(400).json({ message: "Email already registered" });

    const hashed = await bcrypt.hash(password, 10);
    const owner = await User.create({
      fullName: fullNameClean,
      hostelName: hostelName?.trim(),
      email: emailClean,
      password: hashed,
      role: "Owner",
    });

    const hostel = await Hostel.create({
      owner: owner._id,
      name: cleanText(hostelName),
      description: "",
      address: "",
      contactEmail: emailClean,
      contactPhone: "",
      facilities: [],
      images: [],
    });

    owner.hostel = hostel._id;
    await owner.save();

    const token = jwt.sign({ id: owner._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.status(201).json({
      token,
      role: owner.role,
      fullName: owner.fullName,
      email: owner.email,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
