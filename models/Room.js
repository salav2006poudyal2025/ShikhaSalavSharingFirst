const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema(
  {
    hostel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hostel",
      required: true,
    },
    roomNumber: { type: Number, required: true, min: 1 },
    seaterType: { type: Number, enum: [2, 3, 4], required: true },
    totalSeats: { type: Number, required: true },
    occupiedSeats: { type: Number, default: 0 },
    monthlyFee: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["Available", "Full"],
      default: "Available",
    },
    description: { type: String, trim: true },
    images: [{ type: String, trim: true }],
  },
  { timestamps: true }
);

roomSchema.index({ hostel: 1, roomNumber: 1 }, { unique: true, partialFilterExpression: { hostel: { $exists: true } } });

module.exports = mongoose.model("Room", roomSchema);
