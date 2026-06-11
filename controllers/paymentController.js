const Payment = require("../models/Payment");
const Booking = require("../models/Booking");
const Room = require("../models/Room");

function authorizePayment(payment, user) {
  if (!user?.hostel) return false;
  return payment.hostel?.toString() === user.hostel.toString();
}

// GET /api/payments - all payments (optionally filtered by month)
exports.getPayments = async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const filter = { month, hostel: req.user.hostel };

    const payments = await Payment.find(filter)
      .populate({
        path: "booking",
        populate: { path: "room" },
      })
      .sort({ createdAt: -1 });

    res.json(payments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/payments/all - all payments across all months
exports.getAllPayments = async (req, res) => {
  try {
    const payments = await Payment.find({ hostel: req.user.hostel })
      .populate({
        path: "booking",
        populate: { path: "room" },
      })
      .sort({ month: -1, createdAt: -1 });

    res.json(payments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/payments/:id - mark as Complete or Pending
exports.updatePayment = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) return res.status(404).json({ message: "Payment not found" });
    if (!authorizePayment(payment, req.user)) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (!["Pending", "Complete"].includes(req.body.status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    payment.status = req.body.status;
    await payment.save();
    res.json(payment);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/payments/generate - generate next month's payments for approved bookings
exports.generateMonthlyPayments = async (req, res) => {
  try {
    const month = req.body.month || new Date().toISOString().slice(0, 7);

    const approvedBookings = await Booking.find({
      status: "Approved",
      hostel: req.user.hostel,
    }).populate("room");

    let created = 0;
    for (const booking of approvedBookings) {
      const exists = await Payment.findOne({
        booking: booking._id,
        month,
        hostel: req.user.hostel,
      });
      if (!exists) {
        const amount = booking.room?.monthlyFee || 0;
        if (amount < 0) continue; // skip invalid
        await Payment.create({
          booking: booking._id,
          hostel: req.user.hostel,
          month,
          amount,
        });
        created++;
      }
    }

    res.json({ message: `Generated ${created} payment record(s) for ${month}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/payments/reset - reset current month's payments to Pending
exports.resetPayments = async (req, res) => {
  try {
    const month = new Date().toISOString().slice(0, 7);
    await Payment.updateMany({ month, hostel: req.user.hostel }, { status: "Pending" });
    res.json({ message: "Payments reset to Pending" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
