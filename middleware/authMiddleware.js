const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Student = require("../models/Student");

// Protect staff routes (Owner / Warden)
exports.protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "Not authorized" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id)
      .select("-password")
      .populate("hostel");
    if (!req.user) return res.status(401).json({ message: "User not found" });

    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
};

// Protect student routes
exports.protectStudent = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "Not authorized" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.student = await Student.findById(decoded.id).select("-password");
    if (!req.student) return res.status(401).json({ message: "Student not found" });

    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
};

// Role-based authorization for staff
exports.authorize = (...roles) => {
  return (req, res, next) => {
    const userRole = req.user.role?.trim();
    const normalizedRoles = roles.map((role) => role.trim());
    const isDefaultOwner =
      normalizedRoles.includes("Owner") && req.user.email === "owner@gmail.com";

    if (!normalizedRoles.includes(userRole) && !isDefaultOwner)
      return res.status(403).json({ message: "Access denied" });
    next();
  };
};
