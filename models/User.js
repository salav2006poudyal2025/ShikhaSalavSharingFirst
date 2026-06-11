const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    hostelName: { type: String, trim: true },
    hostel: { type: mongoose.Schema.Types.ObjectId, ref: "Hostel" },
    phone: { type: String, trim: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["Owner", "Warden"], required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
