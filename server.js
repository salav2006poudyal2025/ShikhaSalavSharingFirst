require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const path = require("path");

const connectDB = require("./config/db");
const User = require("./models/User");
const Hostel = require("./models/Hostel");

const app = express();

app.use(express.json());
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ],
    credentials: true,
  })
);
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

async function seedDefaultOwner() {
  const email = "owner@gmail.com";
  const password = "owner12345";
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
    console.log("Default owner created: owner@gmail.com / owner12345");
    return owner;
  }

  const passwordMatches = await bcrypt.compare(password, owner.password);
  let changed = false;

  if (!passwordMatches) {
    owner.password = hashed;
    changed = true;
  }

  if (owner.role !== "Owner") {
    owner.role = "Owner";
    changed = true;
  }

  if (!owner.hostelName) {
    owner.hostelName = "Shikha Girls Hostel";
    changed = true;
  }

  if (!owner.fullName) {
    owner.fullName = "System Owner";
    changed = true;
  }

  if (changed) {
    await owner.save();
    console.log("Default owner account repaired: owner@gmail.com / owner12345");
  }

  return owner;
}

async function seedDefaultHostel(owner) {
  if (!owner) return;

  let existingHostel = await Hostel.findOne({ owner: owner._id });
  if (!existingHostel) {
    existingHostel = await Hostel.create({
      owner: owner._id,
      name: "Shikha Girls Hostel",
      description:
        "A secure and caring hostel for women students with modern facilities and friendly staff.",
      address: "Ramnagar, Kathmandu, Nepal",
      contactEmail: "owner@gmail.com",
      contactPhone: "9812345678",
      facilities: [
        "24/7 Security",
        "High-Speed Wi-Fi",
        "Daily Meals",
        "Study Area",
        "Laundry Service",
        "Power Backup",
      ],
      images: [],
    });
  }

  if (!owner.hostel || owner.hostel.toString() !== existingHostel._id.toString()) {
    owner.hostel = existingHostel._id;
    await owner.save();
  }
}

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/student", require("./routes/studentRoutes"));
app.use("/api/owner", require("./routes/ownerRoutes"));
app.use("/api/hostel", require("./routes/hostelRoutes"));
app.use("/api/hostels", require("./routes/hostelsRoutes"));
app.use("/api/rooms", require("./routes/roomRoutes"));
app.use("/api/bookings", require("./routes/bookingRoutes"));
app.use("/api/payments", require("./routes/paymentRoutes"));

app.get("/", (req, res) =>
  res.json({ message: "Hostel Management API running" })
);

async function startServer() {
  await connectDB();
  const owner = await seedDefaultOwner();
  await seedDefaultHostel(owner);

  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

startServer().catch((err) => {
  console.error("Server startup error:", err.message);
  process.exit(1);
});
