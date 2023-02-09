var express = require('express');
var router = express.Router();
var jwt = require('jsonwebtoken');
var bcrypt = require('bcrypt');
const cassandra = require('cassandra-driver');

const UUID = require('cassandra-driver').types.Uuid;


// Connect to Cassandra
const database = new cassandra.Client({
  contactPoints: ['127.0.0.1'],
  localDataCenter: 'datacenter1',
  keyspace: 'app'
});

/* GET home page. */
router.get('/server/:id/', function(req, res, next) {

  // Accept id only if it is a number
  if (isNaN(req.params.id)) {
    return res.status(400).json(
      {
        status: 400,
        error:true,
        message: "Bad Request"
      }
    );
  }

  database.execute('SELECT * FROM servers WHERE serverid = ? ALLOW FILTERING', [req.params.id], { prepare: true })
    .then(result => {
      if (result.rows.length == 0) {
        return res.status(404).json(
          {
            status: 404,
            error:true,
            message: 'Server not found'
          }
        );
      } else {
        return res.status(200).json(
          {
            status: 200,
            error:false,
            message: 'Server found',
            data: result.rows[0]
          }
        );
      }
    }
  ).catch(err => {
    return res.status(404).json(
      {
        status: 404,
        error:true,
        message: 'server not found'
      }
    );
  });
  
});


// Generate Token function
function generateAccessToken(user) {
  return jwt.sign(user, process.env.TOKEN_SECRET, { expiresIn: '1800s' });
}

// Authenticate Token function
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token == null) return res.sendStatus(401);

  jwt.verify(token, process.env.TOKEN_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// Refresh Token function
function refreshToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token == null) return res.sendStatus(401);

  jwt.verify(token, process.env.TOKEN_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// Login function
router.get('/login', function(req, res, next) {
  var username = req.query.username;
  var password = req.query.password;

  // Check if username and password are empty
  if (username == '' || password == '') {
    return res.send({ status: 0, message: 'Username or password is empty' });
  }
  
  // verify password hash
  database.execute('SELECT * FROM users WHERE username = ? ALLOW FILTERING', [username], { prepare: true })
    .then(result => {
      if (result.rows.length == 0) {
        return res.send({
          status: 401,
          error: true,
          message: 'Username or password is incorrect'
        });
      } else {
        const userUuid = result.rows[0].id;
        bcrypt.compare(password, result.rows[0].password, function(err, result) {
          if (result == true) {
            const user = { username: username, id: userUuid.toString() };
            const accessToken = generateAccessToken(user);
            return res.send(
              {
                status: 200,
                message: 'User found',
                user: {
                  username: username,
                  accessToken: accessToken,
                  expiresIn: Math.floor(Date.now() / 1000) + 1800
                }
              }
            );
          } else {
            return res.send({ status: 0, message: 'Incorrect password' });
          }
        });
      }
    }
  ).catch(err => {
    return res.send({ status: 0, message: 'User not found' });
  });
});


// Register endpoint
router.get('/register', function(req, res, next) {

  var username = req.query.username;
  var password = req.query.password;

  if(!username && !password) {
    return res.send(
      {
        status: 400,
        message: 'Please enter username and password'
      }
    );
  }

  // Check username for special characters and length using regex
  if(!/^[a-z0-9_.]*$/.test(username) || username.length < 4 || username.length > 16) {
    return res.send(
      {
        status: 400,
        message: 'Username must be between 4 and 16 characters and contain only letters, numbers, underscores and periods'
      }
    );
  }

  password = bcrypt.hashSync(password, 10);

  // Check if username already exists if not execute insert query
  database.execute('SELECT * FROM users WHERE username = ? ALLOW FILTERING', [username], { prepare: true })
    .then(result => {
      console.log(result.rows);
      if (result.rows.length == 0) {
        database.execute('INSERT INTO users (username, password, id) VALUES (?, ?, ?)', [username, password, UUID.random()], { prepare: true })
          .then(result => {
            return res.send(
              {
                status: 200,
                message: 'User created'
              }
            );
          }
        ).catch(err => {
          return res.send(
            {
              status: 400,
              message: 'Error creating user'
            }
          );
        });
      } else {
        return res.send(
          {
            status: 400,
            message: 'Username already exists'
          }
        );
      }
    }
  ).catch(err => {
    console.log(err);
    return res.send(
      {
        status: 400,
        message: 'Error creating user'
      }
    );
  });

});

// Profile endpoint
router.get('/profile', authenticateToken, function(req, res, next) {
  var username = req.user.user;
  database.execute('SELECT * FROM users WHERE username = ?', [username], { prepare: true })
    .then(result => {
      if (result.rows.length == 0) {
        return res.send({ status: 0, message: 'User not found' });
      } else {
        return res.send({ status: 1, message: 'User found', data: result.rows });
      }
    }
  ).catch(err => {
    return res.send({ status: 0, message: 'User not found' });
  });
});

// Account endpoint with id
router.get('/account/:id', function(req, res, next) {
  var id = req.params.id;
  target = 'username';
  if (req.query.ByID == 'true') {
    target = 'id';
  }

  database.execute('SELECT * FROM users WHERE '+target+' = ? ALLOW FILTERING', [id], { prepare: true })
    .then(result => {
      if (result.rows.length == 0) {
        return res.send({ status: 0, message: 'User not found' });
      } else {
        return res.send({ status: 1, message: 'User found', data: result.rows });
      }
    }
  ).catch(err => {
    return res.send({ status: 0, message: 'User not found' });
  });
});


// Test and verify token from get query string
router.get('/verify', authenticateToken, function(req, res, next) {
  return res.send({ status: 200, message: 'Token verified' });
});


// search for users and return array of users
router.get('/search', function(req, res, next) {
  var username = req.query.username;
  database.execute('SELECT username FROM users WHERE username LIKE ? ALLOW FILTERING', ['%'+username+'%'], { prepare: true })
    .then(result => {
      if (result.rows.length == 0) {
        return res.send({ status: 0, message: 'User not found' });
      } else {
        return res.send({ status: 1, message: 'User found', results: result.rows });
      }
    }
  ).catch(err => {
    return res.send({ status: 0, message: 'User not found' });
  });
});

module.exports = router;
