const Booking = require("../models/Booking");
const Room = require("../models/Room");
const Payment = require("../models/Payment");
const {
  cleanEmail,
  cleanText,
  firstValidationError,
  validateAddress,
  validateDob,
  validateEducation,
  validateEmail,
  validateName,
  validatePhone,
} = require("../utils/validation");

async function expireStaleBookings() {
  await Booking.updateMany(
    {
      status: "Pending",
      "tokenPayment.status": "Pending",
      "tokenPayment.expiresAt": { $lt: new Date() },
    },
    {
      $set: {
        status: "Rejected",
        "tokenPayment.status": "Expired",
      },
    }
  );
}

function authorizeBooking(booking, user) {
  if (!user?.hostel) return { allowed: false, message: "Access denied" };
  if (!booking?.hostel) return { allowed: false, message: "Access denied" };
  if (booking.hostel.toString() !== user.hostel.toString()) {
    return { allowed: false, message: "Access denied" };
  }
  return { allowed: true };
}

// POST /api/bookings (public - student submits booking)
exports.createBooking = async (req, res) => {
  await expireStaleBookings();
  try {
    const {
      dob,
      educationStatus,
      email,
      fullName,
      permanentAddress,
      phone,
      room: roomId,
      student,
      temporaryAddress,
    } = req.body;
    const emailClean = cleanEmail(email);
    const fullNameClean = cleanText(fullName);
    const validationError = firstValidationError([
      validateName(fullNameClean),
      validatePhone(phone),
      validateEmail(emailClean),
      validateDob(dob),
      validateEducation(educationStatus),
      validateAddress(permanentAddress, "Permanent address"),
    ]);

    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const room = await Room.findById(roomId);
    if (!room) return res.status(404).json({ message: "Room not found" });
    if (room.status === "Full") return res.status(400).json({ message: "Room is full" });

    const existing = await Booking.findOne({ email: emailClean, status: "Pending" });
    if (existing) {
      return res.status(400).json({ message: "You already have a pending booking request" });
    }

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const reference = `${emailClean}-${Date.now()}`;

    const booking = await Booking.create({
      student: student || undefined,
      fullName: fullNameClean,
      phone: cleanText(phone),
      email: emailClean,
      permanentAddress: cleanText(permanentAddress),
      temporaryAddress: cleanText(temporaryAddress),
      dob,
      educationStatus,
      hostel: room.hostel,
      room: roomId,
      tokenPayment: {
        amount: 500,
        method: "Khalti",
        status: "Pending",
        expiresAt,
        reference,
      },
    });

    res.status(201).json(booking);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/bookings/approve/:id
exports.approveBooking = async (req, res) => {
  try {
    await expireStaleBookings();
    const booking = await Booking.findById(req.params.id).populate("room");
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    const auth = authorizeBooking(booking, req.user);
    if (!auth.allowed) return res.status(403).json({ message: auth.message });

    if (booking.status !== "Pending") return res.status(400).json({ message: "Booking already actioned" });
    if (booking.tokenPayment?.status !== "Confirmed") {
      return res.status(400).json({ message: "Rs.500 Khalti token payment must be confirmed before approval" });
    }

    const room = booking.room;
    if (room.occupiedSeats >= room.totalSeats) {
      return res.status(400).json({ message: "Room is full" });
    }

    booking.status = "Approved";
    booking.actionedBy = req.user.role;
    await booking.save();

    room.occupiedSeats += 1;
    room.status = room.occupiedSeats >= room.totalSeats ? "Full" : "Available";
    await room.save();

    const month = new Date().toISOString().slice(0, 7);
    await Payment.create({
      booking: booking._id,
      hostel: booking.hostel,
      month,
      amount: room.monthlyFee,
    });

    res.json({ message: "Booking approved" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/bookings/reject/:id
exports.rejectBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    const auth = authorizeBooking(booking, req.user);
    if (!auth.allowed) return res.status(403).json({ message: auth.message });

    if (booking.status !== "Pending") return res.status(400).json({ message: "Booking already actioned" });

    booking.status = "Rejected";
    booking.actionedBy = req.user.role;
    await booking.save();

    res.json({ message: "Booking rejected" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/bookings/students
exports.getStudents = async (req, res) => {
  try {
    await expireStaleBookings();
    const students = await Booking.find({ hostel: req.user.hostel })
      .populate("room")
      .sort({ createdAt: -1 });
    res.json(students);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/bookings/students/:id
exports.updateStudent = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Student not found" });

    const auth = authorizeBooking(booking, req.user);
    if (!auth.allowed) return res.status(403).json({ message: auth.message });

    if (booking.status === "Approved") {
      return res.status(400).json({ message: "Cannot update an approved booking" });
    }

    const allowed = [
      "fullName",
      "phone",
      "email",
      "permanentAddress",
      "temporaryAddress",
      "dob",
      "educationStatus",
    ];
    const next = { ...booking.toObject(), ...req.body };
    const emailClean = cleanEmail(next.email);
    const validationError = firstValidationError([
      validateName(next.fullName),
      validatePhone(next.phone),
      validateEmail(emailClean),
      validateDob(next.dob),
      validateEducation(next.educationStatus),
      validateAddress(next.permanentAddress, "Permanent address"),
    ]);

    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    allowed.forEach((field) => {
      if (req.body[field] === undefined) return;
      booking[field] = typeof req.body[field] === "string" ? cleanText(req.body[field]) : req.body[field];
    });
    booking.email = emailClean;
    await booking.save();

    res.json(booking);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE /api/bookings/students/:id
exports.deleteStudent = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Student not found" });

    const auth = authorizeBooking(booking, req.user);
    if (!auth.allowed) return res.status(403).json({ message: auth.message });

    if (booking.status === "Approved") {
      const room = await Room.findById(booking.room);
      if (room && room.occupiedSeats > 0) {
        room.occupiedSeats -= 1;
        room.status = "Available";
        await room.save();
      }
      await Payment.deleteMany({ booking: booking._id });
    }

    await booking.deleteOne();
    res.json({ message: "Student record deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
