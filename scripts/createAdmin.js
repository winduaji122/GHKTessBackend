const User = require('../models/User');
const bcrypt = require('bcrypt');

async function createAdmin() {
    const adminExists = await User.findOne({ role: 'admin' });
    if (adminExists) {
        console.log('Admin already exists');
        return;
    }

    const hashedPassword = await bcrypt.hash('adminpassword', 10);
    const admin = new User({
        username: 'admin',
        password: hashedPassword,
        role: 'admin'
    });

    await admin.save();
    console.log('Admin created successfully');
}

createAdmin();
