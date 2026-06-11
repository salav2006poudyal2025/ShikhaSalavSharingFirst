const router = require("express").Router();
const {
  getHostel,
  updateHostel,
  uploadHostelImages,
  deleteHostelImage,
} = require("../controllers/hostelController");
const { protect, authorize } = require("../middleware/authMiddleware");
const { uploadHostelImages: hostelImageUpload } = require("../middleware/uploadMiddleware");

router.get("/", protect, authorize("Owner", "Warden"), getHostel);
router.put("/", protect, authorize("Owner"), updateHostel);
router.post(
  "/images",
  protect,
  authorize("Owner"),
  hostelImageUpload,
  uploadHostelImages
);
router.delete(
  "/images/:imageId",
  protect,
  authorize("Owner"),
  deleteHostelImage
);

module.exports = router;
