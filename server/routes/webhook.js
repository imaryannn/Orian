const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
// Use the same authenticated queue, ownership, and validation as the main API.
router.use(requireAuth);
router.post('/trigger', (req, res, next) => {
  req.url = '/';
  require('./goal')(req, res, next);
});
module.exports = router;
