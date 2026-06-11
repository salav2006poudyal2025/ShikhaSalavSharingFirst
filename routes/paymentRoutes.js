const router = require("express").Router();
const {
  getPayments,
  getAllPayments,
  updatePayment,
  generateMonthlyPayments,
  resetPayments,
} = require("../controllers/paymentController");
const { protect, authorize } = require("../middleware/authMiddleware");

router.use(protect, authorize("Owner", "Warden"));

router.get("/", getPayments);               // ?month=2025-01 optional
router.get("/all", getAllPayments);
router.put("/:id", updatePayment);
router.post("/generate", generateMonthlyPayments);
router.post("/reset", resetPayments);

module.exports = router;
