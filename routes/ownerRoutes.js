const router = require("express").Router();
const {
  createWarden,
  getWardens,
  updateWarden,
  deleteWarden,
} = require("../controllers/ownerController");
const { protect, authorize } = require("../middleware/authMiddleware");

router.use(protect, authorize("Owner"));

router.get("/wardens", getWardens);
router.post("/wardens", createWarden);
router.put("/wardens/:id", updateWarden);
router.delete("/wardens/:id", deleteWarden);

module.exports = router;
