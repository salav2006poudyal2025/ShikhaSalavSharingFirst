const mongoose = require("mongoose");

const hostelSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    address: { type: String, trim: true },
    contactEmail: { type: String, lowercase: true, trim: true },
    contactPhone: { type: String, trim: true },
    facilities: [{ type: String, trim: true }],
    rules: [{ type: String, trim: true }],
    images: [{ type: String, trim: true }],
    imageFiles: [
      {
        filename: { type: String, trim: true },
        contentType: { type: String, trim: true },
        data: { type: Buffer },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Hostel", hostelSchema);
