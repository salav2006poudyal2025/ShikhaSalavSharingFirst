const Student = require("../models/Student");
const Booking = require("../models/Booking");
const Payment = require("../models/Payment");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const {
  cleanEmail,
  cleanText,
  firstValidationError,
  validateAddress,
  validateDob,
  validateEducation,
  validateEmail,
  validateName,
  validatePassword,
  validatePhone,
} = require("../utils/validation");

const khaltiBaseUrl =
  process.env.KHALTI_BASE_URL || "https://dev.khalti.com/api/v2/epayment";

function khaltiAmount(amount) {
  return Math.round(Number(amount || 0) * 100);
}

function isKhaltiInvalidToken(data) {
  return /invalid token/i.test(
    String(data?.detail || data?.message || data?.error || "")
  );
}

async function postKhalti(path, payload, authPrefix) {
  const response = await fetch(`${khaltiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `${authPrefix} ${process.env.KHALTI_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function callKhalti(path, payload) {
  if (!process.env.KHALTI_SECRET_KEY) {
    const err = new Error("Khalti secret key is not configured");
    err.statusCode = 500;
    throw err;
  }

  let { response, data } = await postKhalti(path, payload, "Key");

  if (!response.ok && isKhaltiInvalidToken(data)) {
    ({ response, data } = await postKhalti(path, payload, "key"));
  }

  if (!response.ok) {
    const invalidToken = isKhaltiInvalidToken(data);
    const err = new Error(
      invalidToken
        ? "Khalti rejected the merchant secret key. Use the ePayment live_secret_key from Khalti merchant dashboard, not the public key or old widget key."
        : data.detail ||
            data.error ||
            data.message ||
            data?.amount?.[0] ||
            "Khalti request failed"
    );
    err.statusCode = response.status;
    err.details = data;
    throw err;
  }

  return data;
}

async function findStudentBooking(req, bookingId) {
  return Booking.findOne({
    _id: bookingId,
    student: req.student._id,
  }).populate("room");
}

function serializeTokenPayment(tokenPayment) {
  if (!tokenPayment) return null;
  return {
    amount: tokenPayment.amount,
    status: tokenPayment.status,
    transactionId: tokenPayment.transactionId,
    pidx: tokenPayment.pidx,
    paymentUrl: tokenPayment.paymentUrl,
    method: tokenPayment.method,
    reference: tokenPayment.reference,
    expiresAt: tokenPayment.expiresAt,
    paidAt: tokenPayment.paidAt,
  };
}

async function confirmTokenPayment(booking, paymentDetails = {}) {
  booking.tokenPayment.status = "Confirmed";
  booking.tokenPayment.transactionId =
    paymentDetails.transaction_id ||
    paymentDetails.idx ||
    booking.tokenPayment.transactionId ||
    booking.tokenPayment.pidx;
  booking.tokenPayment.paidAt = new Date();
  await booking.save();
}

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

// POST /api/student/register
exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const cleanName = cleanText(name);
    const emailClean = cleanEmail(email);
    const validationError = firstValidationError([
      validateName(cleanName),
      validateEmail(emailClean),
      validatePassword(password),
    ]);

    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const exists = await Student.findOne({ email: emailClean });
    if (exists) return res.status(400).json({ message: "Email already registered" });

    const hashed = await bcrypt.hash(password, 10);
    const student = await Student.create({
      name: cleanName,
      email: emailClean,
      password: hashed,
    });

    const token = jwt.sign({ id: student._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.status(201).json({
      token,
      student: { id: student._id, name: student.name, email: student.email },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/student/login - accepts { email, password }
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

    const student = await Student.findOne({ email: emailClean });

    if (!student) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const match = await bcrypt.compare(passwordClean, student.password);
    if (!match) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign({ id: student._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({
      token,
      student: { id: student._id, name: student.name, email: student.email },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/student/me - returns full student profile, booking, and payments.
exports.getMe = async (req, res) => {
  try {
    await expireStaleBookings();
    const student = req.student;

    const booking = await Booking.findOne({
      $or: [{ student: student._id }, { email: student.email }],
    })
      .sort({ createdAt: -1 })
      .populate("room");

    if (booking && booking.status === "Pending" && booking.tokenPayment?.status === "Pending") {
      if (booking.tokenPayment.expiresAt && new Date(booking.tokenPayment.expiresAt) < new Date()) {
        booking.status = "Rejected";
        booking.tokenPayment.status = "Expired";
        await booking.save();
      }
    }

    let payments = [];
    if (booking) {
      payments = await Payment.find({ booking: booking._id }).sort({ createdAt: -1 });
    }

    res.json({
      student: {
        name: student.name,
        email: student.email,
      },
      booking: booking
        ? {
            _id: booking._id,
            status: booking.status,
            createdAt: booking.createdAt,
            fullName: booking.fullName,
            phone: booking.phone,
            email: booking.email,
            permanentAddress: booking.permanentAddress,
            temporaryAddress: booking.temporaryAddress,
            dob: booking.dob,
            educationStatus: booking.educationStatus,
            room: booking.room
              ? {
                  _id: booking.room._id,
                  roomNumber: booking.room.roomNumber,
                  seaterType: booking.room.seaterType,
                  monthlyFee: booking.room.monthlyFee,
                  totalSeats: booking.room.totalSeats,
                  occupiedSeats: booking.room.occupiedSeats,
                }
              : null,
            tokenPayment: serializeTokenPayment(booking.tokenPayment),
          }
        : null,
      payments: payments.map((p) => ({
        _id: p._id,
        month: p.month,
        amount: p.amount,
        status: p.status,
        createdAt: p.createdAt,
      })),
      tokenPayment: serializeTokenPayment(booking?.tokenPayment),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/student/khalti/initiate - create a local dummy QR payment session.
exports.initiateKhaltiPayment = async (req, res) => {
  try {
    await expireStaleBookings();
    const { bookingId } = req.body;
    if (!bookingId) {
      return res.status(400).json({ message: "bookingId is required" });
    }

    const booking = await findStudentBooking(req, bookingId);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    if (booking.status !== "Pending") return res.status(400).json({ message: "Booking is not pending" });
    if (!booking.tokenPayment || booking.tokenPayment.status !== "Pending") {
      return res.status(400).json({ message: "Payment is not pending or already processed" });
    }

    if (booking.tokenPayment.expiresAt && new Date(booking.tokenPayment.expiresAt) < new Date()) {
      booking.status = "Rejected";
      booking.tokenPayment.status = "Expired";
      await booking.save();
      return res.status(400).json({ message: "Payment window has expired" });
    }

    const reference = booking.tokenPayment.reference || `${booking.email}-${Date.now()}`;
    const pidx = `dummy_${booking._id}_${Date.now()}`;
    const paymentUrl = JSON.stringify({
      merchant: "Shikha Girls Hostel",
      method: "Khalti Dummy QR",
      amount: booking.tokenPayment.amount,
      reference,
      bookingId: String(booking._id),
      pidx,
    });

    booking.tokenPayment.method = "Khalti";
    booking.tokenPayment.reference = reference;
    booking.tokenPayment.pidx = pidx;
    booking.tokenPayment.paymentUrl = paymentUrl;
    await booking.save();

    res.json({
      pidx,
      payment_url: paymentUrl,
      expires_at: booking.tokenPayment.expiresAt,
      expires_in: booking.tokenPayment.expiresAt
        ? Math.max(Math.floor((new Date(booking.tokenPayment.expiresAt) - new Date()) / 1000), 0)
        : null,
      amount: booking.tokenPayment.amount,
      dummy: true,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({
      message: err.message,
      details: err.details,
    });
  }
};

// POST /api/student/khalti/verify - confirm the local dummy QR payment.
exports.verifyKhaltiPayment = async (req, res) => {
  try {
    await expireStaleBookings();
    const { bookingId, pidx } = req.body;
    if (!bookingId || !pidx) {
      return res.status(400).json({ message: "bookingId and pidx are required" });
    }

    const booking = await findStudentBooking(req, bookingId);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (booking.tokenPayment?.status === "Confirmed") {
      return res.json({
        success: true,
        message: "Payment already confirmed",
        booking,
      });
    }

    if (booking.status !== "Pending") return res.status(400).json({ message: "Booking is not pending" });
    if (!booking.tokenPayment || booking.tokenPayment.status !== "Pending") {
      return res.status(400).json({ message: "Payment is not pending or already processed" });
    }

    if (booking.tokenPayment.expiresAt && new Date(booking.tokenPayment.expiresAt) < new Date()) {
      booking.status = "Rejected";
      booking.tokenPayment.status = "Expired";
      await booking.save();
      return res.status(400).json({ message: "Payment window has expired" });
    }

    if (booking.tokenPayment.pidx && booking.tokenPayment.pidx !== pidx) {
      return res.status(400).json({ message: "Payment session does not match this booking" });
    }

    booking.tokenPayment.pidx = pidx;
    await confirmTokenPayment(booking, {
      transaction_id: `DUMMY-KHALTI-${Date.now()}`,
    });

    res.json({
      success: true,
      message: "Payment verified. Your booking is waiting for owner approval.",
      booking,
      verification: {
        pidx,
        total_amount: khaltiAmount(booking.tokenPayment.amount),
        status: "Completed",
        dummy: true,
      },
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({
      message: err.message,
      details: err.details,
    });
  }
};

// POST /api/student/token-payment - legacy Khalti widget token verification.
exports.tokenPayment = async (req, res) => {
  try {
    const { bookingId, token } = req.body;
    if (!bookingId || !token) {
      return res.status(400).json({ message: "bookingId and token are required" });
    }

    if (!process.env.KHALTI_SECRET_KEY) {
      return res.status(500).json({ message: "Khalti secret key is not configured" });
    }

    const booking = await findStudentBooking(req, bookingId);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    if (booking.status !== "Pending") return res.status(400).json({ message: "Booking is not pending" });
    if (!booking.tokenPayment || booking.tokenPayment.status !== "Pending") {
      return res.status(400).json({ message: "Payment is not pending or already processed" });
    }

    const response = await fetch("https://khalti.com/api/v2/payment/verify/", {
      method: "POST",
      headers: {
        Authorization: `Key ${process.env.KHALTI_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token,
        amount: khaltiAmount(booking.tokenPayment.amount),
      }),
    });

    const verification = await response.json();
    if (!response.ok || !verification.idx) {
      return res.status(400).json({
        message: verification.detail || verification.error || "Khalti verification failed",
        verification,
      });
    }

    await confirmTokenPayment(booking, verification);

    res.json({
      success: true,
      message: "Payment verified. Your booking is waiting for owner approval.",
      booking,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// PUT /api/student/me - update student and booking profile
exports.updateMe = async (req, res) => {
  try {
    const { name, email, phone, dob, permanentAddress, temporaryAddress, educationStatus } = req.body;
    const student = req.student;
    const nextName = name !== undefined ? cleanText(name) : undefined;
    const nextEmail = email !== undefined ? cleanEmail(email) : undefined;
    const validationError = firstValidationError([
      nextName !== undefined ? validateName(nextName) : "",
      nextEmail !== undefined ? validateEmail(nextEmail) : "",
      phone !== undefined ? validatePhone(phone) : "",
      dob !== undefined ? validateDob(dob) : "",
      permanentAddress !== undefined
        ? validateAddress(permanentAddress, "Permanent address")
        : "",
      educationStatus !== undefined ? validateEducation(educationStatus) : "",
    ]);

    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    if (nextEmail && nextEmail !== student.email) {
      const exists = await Student.findOne({ email: nextEmail, _id: { $ne: student._id } });
      if (exists) return res.status(400).json({ message: "Email already registered" });
    }

    if (nextName) student.name = nextName;
    if (nextEmail) student.email = nextEmail;
    await student.save();

    const booking = await Booking.findOne({
      $or: [{ student: student._id }, { email: student.email }],
    }).sort({ createdAt: -1 });

    if (booking) {
      if (nextName) booking.fullName = nextName;
      if (nextEmail) booking.email = nextEmail;
      if (phone !== undefined) booking.phone = cleanText(phone);
      if (dob !== undefined) booking.dob = dob;
      if (permanentAddress !== undefined) {
        booking.permanentAddress = cleanText(permanentAddress);
      }
      if (temporaryAddress !== undefined) {
        booking.temporaryAddress = cleanText(temporaryAddress);
      }
      if (educationStatus !== undefined) booking.educationStatus = educationStatus;
      await booking.save();
    }

    res.json({ message: "Profile updated successfully", student });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
