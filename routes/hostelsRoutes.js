const router = require("express").Router();
const { getHostels, getHostelById } = require("../controllers/hostelController");

router.get("/", getHostels);
router.get("/:id", getHostelById);

module.exports = router;
