const express = require("express");
const router = express.Router();
const driverController = require("../controllers/driver/driverController");
const { authMiddleware } = require("../middleware/authMiddleware");
const Driver = require("../models/driver/driver");
const bcrypt = require("bcryptjs");
const multer = require('multer');

const jwt = require("jsonwebtoken");
// Configure multer to handle FormData (without saving files)
const upload = multer();

// =============================
//     PUBLIC ROUTES
// =============================

// Login
router.post("/login", (req, res) => {
  driverController.loginDriver(req, res);
});




router.post("/driver-verify-phone", async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    console.log("📞 Verifying driver phone:", phoneNumber);

    if (!phoneNumber) {
      return res.status(400).json({ 
        success: false, 
        message: "Phone number is required" 
      });
    }

    // Clean the phone number (remove +91 and spaces)
    const cleanPhone = phoneNumber.replace('+91', '').replace(/\D/g, '');

    // Check if driver exists in DB
    const driver = await Driver.findOne({
      $or: [
        { phone: cleanPhone },
        { phoneNumber: cleanPhone }
      ]
    });

    if (driver) {
      console.log(`✅ Driver found: ${driver.driverId}`);
      return res.json({
        success: true,
        driver: {
          driverId: driver.driverId,
          name: driver.name,
          vehicleType: driver.vehicleType || 'taxi',
          vehicleNumber: driver.vehicleNumber
        }
      });
    } else {
      console.log(`❌ Driver not found for: ${cleanPhone}`);
      return res.status(404).json({ 
        success: false, 
        message: "Driver not found" 
      });
    }
  } catch (error) {
    console.error("❌ Verify phone error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});



// ✅ Make sure this endpoint doesn't require auth middleware for login
router.post('/get-complete-driver-data', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    console.log('🔍 Getting COMPLETE driver data for:', phoneNumber);

    if (!phoneNumber) return res.status(400).json({ message: 'Phone required' });

    const cleanPhone = phoneNumber.replace('+91', '').replace(/\D/g, '');
    
    // Find driver
    const driver = await Driver.findOne({ 
      $or: [{ phone: cleanPhone }, { phoneNumber: cleanPhone }]
    }).select('-passwordHash');

    if (!driver) return res.status(404).json({ success: false, message: 'Driver not found' });

    // ✅ GENERATE NEW JWT TOKEN
    const token = jwt.sign(
      { 
        id: driver._id, 
        driverId: driver.driverId, 
        phone: driver.phone,
        role: 'driver' 
      },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '30d' }
    );

    console.log(`✅ Generated JWT token for driver: ${driver.driverId}`);

    res.json({
      success: true,
      token: token, // Send the token to the frontend
      driver: {
        driverId: driver.driverId,
        name: driver.name,
        phone: driver.phone,
        vehicleType: driver.vehicleType,
        vehicleNumber: driver.vehicleNumber,
        wallet: driver.wallet || 0,
        status: driver.status || 'Offline',
        fcmToken: driver.fcmToken,
        location: driver.location
      }
    });

  } catch (error) {
    console.error('❌ Error getting complete data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});



// Create a test driver
router.post("/create-test-driver", (req, res) => {
  driverController.createDriver(req, res);
});



// In driverRoutes.js - Add this endpoint
router.post("/accept-ride", async (req, res) => {
  try {
    const { driverId, rideId, vehicleType } = req.body;
    console.log(`✅ DRIVER ACCEPT RIDE: ${driverId} accepting ${rideId}`);
    
    const Ride = require('../models/ride');
    const Driver = require('../models/driver/driver');
    
    // Check if ride exists
    const ride = await Ride.findOne({ RAID_ID: rideId });
    if (!ride) {
      return res.status(404).json({
        success: false,
        message: "Ride not found"
      });
    }
    
    // Check if ride is already accepted
    if (ride.status !== 'pending') {
      return res.status(409).json({
        success: false,
        message: "Ride already accepted by another driver",
        currentDriver: ride.driverId || "Unknown driver"
      });
    }
    
    // Update ride
    ride.driverId = driverId;
    ride.driverName = req.body.driverName || "Driver";
    ride.status = 'accepted';
    ride.acceptedAt = new Date();
    await ride.save();
    
    // Update driver status in database
    await Driver.findOneAndUpdate(
      { driverId },
      { 
        status: 'onRide',
        lastRideId: rideId,
        lastUpdate: new Date()
      }
    );
    
    console.log(`✅ Ride ${rideId} accepted by ${driverId}`);
    
    res.json({
      success: true,
      message: "Ride accepted successfully",
      ride: {
        rideId: ride.RAID_ID,
        pickup: ride.pickup || {
          addr: ride.pickupLocation,
          lat: ride.pickupCoordinates?.latitude,
          lng: ride.pickupCoordinates?.longitude
        },
        drop: ride.drop || {
          addr: ride.dropoffLocation,
          lat: ride.dropoffCoordinates?.latitude,
          lng: ride.dropoffCoordinates?.longitude
        },
        fare: ride.fare || ride.price,
        distance: ride.distance,
        vehicleType: ride.rideType || vehicleType,
        userName: ride.name,
        userMobile: ride.userMobile,
        otp: ride.otp
      }
    });
    
  } catch (error) {
    console.error("❌ Accept ride error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to accept ride",
      error: error.message
    });
  }
});



// Token verification
router.get("/verify", authMiddleware, (req, res) => {
  driverController.verifyDriver(req, res);
});


router.post("/create-simple", upload.none(), async (req, res) => {
  try {
    console.log('📝 SIMPLE: Creating driver without files');
    console.log('📝 Content-Type:', req.headers['content-type']);
    console.log('📝 Request body:', req.body);
    
    // Extract data from request body
    const { 
      name, phone, vehicleNumber, licenseNumber, aadharNumber,
      vehicleType = 'taxi', email = '', dob = null, wallet = 0 // ✅ ADD wallet here
    } = req.body;
    
    console.log('📝 Extracted fields:', {
      name, phone, vehicleNumber, licenseNumber, aadharNumber,
      vehicleType, email, dob, wallet // ✅ ADD wallet to logging
    });
    
    // Validate required fields
    if (!name || !phone || !vehicleNumber || !licenseNumber || !aadharNumber) {
      console.log('❌ Missing required fields');
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: name, phone, vehicleNumber, licenseNumber, aadharNumber',
        received: {
          name: !!name,
          phone: !!phone,
          vehicleNumber: !!vehicleNumber,
          licenseNumber: !!licenseNumber,
          aadharNumber: !!aadharNumber
        }
      });
    }
    
    const Driver = require("../models/driver/driver");
    const bcrypt = require("bcryptjs");
    
    // Check for existing driver (phone, license, Aadhaar, vehicle number)
    const existingDriver = await Driver.findOne({ 
      $or: [
        { phone },
        { licenseNumber },
        { aadharNumber },
        { vehicleNumber }
      ]
    });
    
    if (existingDriver) {
      let conflictField = '';
      if (existingDriver.phone === phone) conflictField = 'phone number';
      else if (existingDriver.licenseNumber === licenseNumber) conflictField = 'license number';
      else if (existingDriver.aadharNumber === aadharNumber) conflictField = 'Aadhaar number';
      else if (existingDriver.vehicleNumber === vehicleNumber) conflictField = 'vehicle number';
      
      return res.status(400).json({
        success: false,
        message: `Driver with this ${conflictField} already exists`,
        existingDriver: {
          driverId: existingDriver.driverId,
          name: existingDriver.name,
          vehicleNumber: existingDriver.vehicleNumber
        }
      });
    }
    
    // ✅ Generate sequential driver ID (NOT based on vehicle number)
    const driverId = await Driver.generateSequentialDriverId();
    console.log('✅ Generated driver ID:', driverId);
    

    
    // Convert wallet to number
    const initialWallet = Number(wallet) || 0;
    
    // Create driver
    const driver = new Driver({
      driverId,
      name,
      phone,
      
      email,
      dob: dob ? new Date(dob) : null,
      licenseNumber,
      aadharNumber,
      vehicleType,
      vehicleNumber,
      wallet: initialWallet, // ✅ SET INITIAL WALLET AMOUNT
      status: 'Offline',
      active: true,
      
      location: {
        type: 'Point',
        coordinates: [0, 0]
      }
    });
    
    await driver.save();
    
    console.log(`✅ SIMPLE: Driver created successfully: ${driverId} with wallet: ${initialWallet}`);
    
    res.status(201).json({
      success: true,
      message: 'Driver created successfully',
      data: {
        driverId: driver.driverId,
        name: driver.name,
        phone: driver.phone,
        vehicleType: driver.vehicleType,
        vehicleNumber: driver.vehicleNumber,
        wallet: driver.wallet // ✅ RETURN WALLET IN RESPONSE
      }
    });
    
  } catch (error) {
    console.error('❌ SIMPLE: Error creating driver:', error);
    
    // Handle duplicate key error specifically
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      const value = error.keyValue[field];
      
      return res.status(400).json({
        success: false,
        message: `Driver with this ${field} (${value}) already exists`,
        error: 'DUPLICATE_KEY'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to create driver',
      error: error.message
    });
  }
});





router.put('/driver/:driverId/wallet', async (req, res) => {
  try {
    const { driverId } = req.params;
    const { amount } = req.body;
    
    console.log(`💰 Updating wallet for driver: ${driverId} with amount: ${amount}`);
    
    if (!amount || isNaN(amount) || amount < 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required (must be a positive number)'
      });
    }
    
    // Convert amount to number
    const addAmount = Number(amount);
    
    // Find driver
    const driver = await Driver.findOne({ driverId: driverId });
    
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }
    
    // Update wallet (initialize to 0 if doesn't exist)
    const currentWallet = driver.wallet || 0;
    const newWallet = currentWallet + addAmount;
    
    // Update driver
    driver.wallet = newWallet;
    driver.updatedAt = new Date();
    await driver.save();
    
    console.log(`✅ Wallet updated: ${driverId} from ${currentWallet} to ${newWallet}`);
    
    res.json({
      success: true,
      message: 'Wallet updated successfully',
      data: {
        driverId: driver.driverId,
        name: driver.name,
        addedAmount: addAmount,
        previousWallet: currentWallet,
        wallet: newWallet,
        updatedAt: driver.updatedAt
      }
    });
    
  } catch (error) {
    console.error('❌ Wallet update error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update wallet',
      error: error.message
    });
  }
});



// Update the login route to use the correct function
router.post("/login", async (req, res) => {
  await loginDriver(req, res);
});





router.get("/nearby", async (req, res) => {
  try {
    const { latitude, longitude, maxDistance = 5000 } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude are required"
      });
    }

    const drivers = await Driver.find({
      status: "Live",
      location: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(longitude), parseFloat(latitude)],
          },
          $maxDistance: parseInt(maxDistance),
        },
      },
    }).select("driverId name location vehicleType status");

    res.json({
      success: true,
      count: drivers.length,
      drivers,
    });

  } catch (err) {
    console.error("❌ Error fetching nearby drivers:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch nearby drivers",
      error: err.message
    });
  }
});



router.post('/complete-driver-login', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    console.log('🔍 COMPLETE LOGIN: Getting driver data for:', phoneNumber);

    if (!phoneNumber) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number is required' 
      });
    }

    const cleanPhone = phoneNumber.replace('+91', '').replace(/\D/g, '');
    
    // Find driver
    const driver = await Driver.findOne({ 
      $or: [{ phone: cleanPhone }, { phoneNumber: cleanPhone }]
    }).select('-passwordHash');

    if (!driver) {
      console.log('❌ Driver not found for phone:', cleanPhone);
      return res.status(404).json({ 
        success: false, 
        message: 'Driver not found. Please register first.' 
      });
    }

    // ✅ Generate JWT token
    const token = jwt.sign(
      { 
        id: driver._id, 
        driverId: driver.driverId, 
        phone: driver.phone,
        role: 'driver' 
      },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '30d' }
    );

    console.log(`✅ Login successful for driver: ${driver.driverId}`);

    res.json({
      success: true,
      token: token,
      driver: {
        driverId: driver.driverId,
        name: driver.name,
        phone: driver.phone,
        vehicleType: driver.vehicleType || "TAXI",
        vehicleNumber: driver.vehicleNumber || "",
        wallet: driver.wallet || 0,
        status: driver.status || "Offline",
        fcmToken: driver.fcmToken || "",
        location: driver.location || { type: 'Point', coordinates: [0, 0] },
        profilePicture: driver.profilePicture || ""
      },
      message: 'Driver authenticated successfully'
    });

  } catch (error) {
    console.error('❌ Complete login error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to complete login',
      error: error.message 
    });
  }
});




// =============================
//  PROTECTED ROUTES
// =============================
router.use(authMiddleware);

// Update FCM Token (FINAL — no duplication)
router.post("/update-fcm-token", async (req, res) => {
  try {
    const { driverId, fcmToken, platform } = req.body;

    console.log('🔄 FCM Token Update:', {
      driverId,
      tokenLength: fcmToken?.length
    });

    const driver = await Driver.findOneAndUpdate(
      { driverId },
      {
        fcmToken,
        platform: platform || "android",
        lastUpdate: new Date()
      },
      { new: true }
    );

    res.json({ success: true, message: "FCM token updated" });
  } catch (error) {
    console.error("❌ FCM token update error:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test Notification
router.post("/test-notification", (req, res) => {
  driverController.sendTestNotification(req, res);
});

// Update Driver Location
router.post("/update-location", (req, res) => {
  driverController.updateLocation(req, res);
});

// =============================
//  RIDE OPERATIONS
// =============================
router.get("/rides/:rideId", (req, res) => {
  driverController.getRideById(req, res);
});

router.put("/rides/:rideId", (req, res) => {
  driverController.updateRideStatus(req, res);
});

// =============================
//  DRIVER MANAGEMENT
// =============================
router.get("/", (req, res) => {
  driverController.getDrivers(req, res);
});

router.get("/nearest", (req, res) => {
  driverController.getNearestDrivers(req, res);
});

router.put("/:driverId", (req, res) => {
  driverController.updateDriver(req, res);
});

router.delete("/:driverId", (req, res) => {
  driverController.deleteDriver(req, res);
});


// In your backend (add to driverRoutes.js)
router.get('/pending-rides/:driverId', async (req, res) => {
  try {
    const { driverId } = req.params;
    
    console.log(`🔍 Checking pending rides for driver: ${driverId}`);
    
    const Ride = require('../models/ride');
    
    // Find rides that are pending and match driver's vehicle type
    const pendingRides = await Ride.find({
      status: 'pending',
      vehicleType: req.query.vehicleType || 'taxi' // Pass driver's vehicle type
    })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();
    
    console.log(`✅ Found ${pendingRides.length} pending rides`);
    
    res.json({
      success: true,
      pendingRides: pendingRides.map(ride => ({
        rideId: ride.RAID_ID,
        pickup: {
          lat: ride.pickupCoordinates?.latitude || ride.pickup?.lat,
          lng: ride.pickupCoordinates?.longitude || ride.pickup?.lng,
          address: ride.pickupLocation || ride.pickup?.addr
        },
        drop: {
          lat: ride.dropoffCoordinates?.latitude || ride.drop?.lat,
          lng: ride.dropoffCoordinates?.longitude || ride.drop?.lng,
          address: ride.dropoffLocation || ride.drop?.addr
        },
        fare: ride.fare || ride.price,
        distance: ride.distance,
        vehicleType: ride.rideType || ride.vehicleType,
        userName: ride.name,
        userMobile: ride.userMobile,
        otp: ride.otp
      }))
    });
    
  } catch (error) {
    console.error('❌ Error fetching pending rides:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending rides',
      error: error.message
    });
  }
});




router.post("/logout", (req, res) => {
  driverController.logoutDriver(req, res);
});

module.exports = router;



// const express = require("express");
// const router = express.Router();
// const driverController = require("../controllers/driver/driverController");
// const { authMiddleware } = require("../middleware/authMiddleware");

// // Debug controller methods
// console.log('🚗 Driver Controller Methods:', Object.keys(driverController).filter(key => typeof driverController[key] === 'function'));

// // Public routes
// router.post("/login", (req, res) => {
//   driverController.loginDriver(req, res);
// });

// router.post("/change-password", (req, res) => {
//   driverController.changePassword(req, res);
// });

// // Test driver creation (public for testing)
// router.post("/create-test-driver", (req, res) => {
//   driverController.createDriver(req, res);
// });

// // Token verification (protected)
// router.get("/verify", authMiddleware, (req, res) => {
//   driverController.verifyDriver(req, res);
// });

// // Protected routes (require authentication)
// router.use(authMiddleware);

// // Make sure this route exists and is properly mounted
// router.post("/update-fcm-token", (req, res) => {
//   driverController.updateFCMToken(req, res);
// });

// router.post("/test-notification", (req, res) => {
//   driverController.sendTestNotification(req, res);
// });

// // Location management
// router.post("/update-location", (req, res) => {
//   driverController.updateLocation(req, res);
// });

// // Nearby drivers (public for users)
// router.get("/nearby", (req, res) => {
//   // This should be in a separate controller, but keeping for compatibility
//   const Driver = require("../models/driver/driver");
  
//   const { latitude, longitude, maxDistance = 5000 } = req.query;
  
//   if (!latitude || !longitude) {
//     return res.status(400).json({ 
//       success: false,
//       message: "Latitude and longitude are required" 
//     });
//   }

//   Driver.find({
//     status: "Live",
//     location: {
//       $near: {
//         $geometry: {
//           type: "Point",
//           coordinates: [parseFloat(longitude), parseFloat(latitude)],
//         },
//         $maxDistance: parseInt(maxDistance),
//       },
//     },
//   })
//   .select("driverId name location vehicleType status")
//   .then(drivers => {
//     res.json({
//       success: true,
//       count: drivers.length,
//       drivers,
//     });
//   })
//   .catch(err => {
//     console.error("❌ Error fetching nearby drivers:", err);
//     res.status(500).json({ 
//       success: false,
//       message: "Failed to fetch nearby drivers",
//       error: err.message 
//     });
//   });
// });

// // Ride operations
// router.get("/rides/:rideId", (req, res) => {
//   driverController.getRideById(req, res);
// });

// router.put("/rides/:rideId", (req, res) => {
//   driverController.updateRideStatus(req, res);
// });

// // Driver management
// router.get("/", (req, res) => {
//   driverController.getDrivers(req, res);
// });

// router.get("/nearest", (req, res) => {
//   driverController.getNearestDrivers(req, res);
// });

// router.put("/:driverId", (req, res) => {
//   driverController.updateDriver(req, res);
// });

// router.delete("/:driverId", (req, res) => {
//   driverController.deleteDriver(req, res);
// });

// router.post("/logout", (req, res) => {
//   driverController.logoutDriver(req, res);
// });

// // DriverRoutes.js-ல் இந்த route add பண்ணு
// router.post('/update-fcm-token', async (req, res) => {
//   try {
//     const { driverId, fcmToken, platform } = req.body;
    
//     console.log('🔄 FCM Token Update:', { 
//       driverId, 
//       tokenLength: fcmToken?.length 
//     });

//     const driver = await Driver.findOneAndUpdate(
//       { driverId },
//       { 
//         fcmToken: fcmToken,
//         platform: platform || 'android',
//         lastUpdate: new Date()
//       },
//       { new: true }
//     );

//     res.json({ success: true, message: 'FCM token updated' });
//   } catch (error) {
//     console.error('FCM token update error:', error);
//     res.status(500).json({ success: false, error: error.message });
//   }
// });

// module.exports = router;
