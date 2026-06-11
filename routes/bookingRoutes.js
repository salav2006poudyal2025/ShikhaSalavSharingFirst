const router = require("express").Router();
const {
  createBooking,
  approveBooking,
  rejectBooking,
  getStudents,
  updateStudent,
  deleteStudent,
} = require("../controllers/bookingController");
const { protect, authorize } = require("../middleware/authMiddleware");

// Public - student submits booking
router.post("/", createBooking);

// Staff-protected
router.get("/students", protect, authorize("Owner", "Warden"), getStudents);
router.put("/approve/:id", protect, authorize("Owner", "Warden"), approveBooking);
router.put("/reject/:id", protect, authorize("Owner", "Warden"), rejectBooking);
router.put("/students/:id", protect, authorize("Owner", "Warden"), updateStudent);
router.delete("/students/:id", protect, authorize("Owner", "Warden"), deleteStudent);

module.exports = router;
