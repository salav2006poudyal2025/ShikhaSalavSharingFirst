const router = require("express").Router();
const {
  getRooms,
  getRoomById,
  createRoom,
  updateRoom,
  deleteRoom,
  queryRooms,
} = require("../controllers/roomController");
const { protect, authorize } = require("../middleware/authMiddleware");

router.get("/", getRooms); // public - needed by landing page and booking form
router.post("/query", queryRooms);
router.get("/:id", getRoomById);

router.post("/", protect, authorize("Owner"), createRoom);
router.put("/:id", protect, authorize("Owner"), updateRoom);
router.delete("/:id", protect, authorize("Owner"), deleteRoom);

module.exports = router;
