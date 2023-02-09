var express = require("express");
var router = express.Router();
var jwt = require("jsonwebtoken");
var bcrypt = require("bcrypt");
const cassandra = require("cassandra-driver");

const UUID = require("cassandra-driver").types.Uuid;

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (token == null) return res.sendStatus(401);

  jwt.verify(token, process.env.TOKEN_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// Connect to Cassandra
const database = new cassandra.Client({
  contactPoints: ["127.0.0.1"],
  localDataCenter: "datacenter1",
  keyspace: "app",
});

/* GET users listing. */
router.get("/", function (req, res, next) {
  res.send("respond with a resource");
});

// dynamic route for user id
router.get("/:username/", authenticateToken, function (req, res, next) {
  database
    .execute(
      "SELECT * FROM users WHERE username = ? ALLOW FILTERING",
      [req.params.username],
      { prepare: true }
    )
    .then((result) => {
      if (result.rows.length == 0) {
        return res.status(404).json({
          status: 404,
          error: true,
          message: "User not found",
        });
      } else {
        let followers = result.rows[0].followers
          ? result.rows[0].followers.length
          : 0;
        let following = result.rows[0].following
          ? result.rows[0].following.length
          : 0;

        let followed = false;
        if (result.rows[0].followers) {
          followed = result.rows[0].followers.some((follower) => {
            return (
              follower.buffer.toString("hex") ===
              UUID.fromString(req.user.id).buffer.toString("hex")
            );
          });
        }

        console.log(followed);

        return res.status(200).json({
          status: 200,
          error: false,
          message: "User found",
          data: {
            id: result.rows[0].id,
            username: result.rows[0].username,
            followers: followers,
            following: following,
            followed: followed,
            avatar: `https://picsum.photos/id/${Math.floor(
              Math.random() * 25
            )}/200/300`,
          },
        });
      }
    })
    .catch((err) => {
      return res.status(404).json({
        status: 404,
        error: true,
        message: "User not found",
      });
    });
});

// follow and unfollow user using cassandra uuid
// table structure:
// id uuid,
// username text,
// displayname text,
// password text,
// followers set<uuid>,
// following set<uuid>,
// friends set<uuid>,
// PRIMARY KEY (id)

router.post("/:uuid/follow", authenticateToken, function (req, res, next) {
  let uuid = req.params.uuid;
  let user = req.user;

  // check if uuid exist in database

  database
    .execute(
      "SELECT * FROM users WHERE id = ? ALLOW FILTERING",
      [UUID.fromString(uuid)],
      { prepare: true }
    )
    .then((result) => {
      if (result.rows.length > 0) {
        // check if result.rows[0].followers has UUID.fromString(user.id)

        let isFollowed = false;
        if (result.rows[0].followers) {
          isFollowed = result.rows[0].followers.some((follower) => {
            return (
              follower.buffer.toString("hex") ===
              UUID.fromString(user.id).buffer.toString("hex")
            );
          });
        }

        if (isFollowed) {
          // remove user id as a set<uuid> from followers
          database
            .execute(
              "UPDATE users SET followers = followers - ? WHERE id = ?",
              [[user.id], UUID.fromString(uuid)],
              { prepare: true }
            )
            .then((result) => {})
            .catch((err) => {});

          database
            .execute(
              "UPDATE users SET following = following - ? WHERE id = ?",
              [[uuid], UUID.fromString(user.id)],
              { prepare: true }
            )
            .then((result) => {
              return res.status(200).json({
                status: 200,
                error: false,
                message: "User unfollowed",
                followed: false,
              });
            })
            .catch((err) => {
              return res.status(500).json({
                status: 500,
                error: true,
                message: "Error unfollowing user" + err,
              });
            });
        } else {
          // add user id as a set<uuid> to followers
          database
            .execute(
              "UPDATE users SET followers = followers + ? WHERE id = ?",
              [[user.id], UUID.fromString(uuid)],
              { prepare: true }
            )
            .then((result) => {})
            .catch((err) => {});

          database
            .execute(
              "UPDATE users SET following = following + ? WHERE id = ?",
              [[uuid], UUID.fromString(user.id)],
              { prepare: true }
            )
            .then((result) => {
              return res.status(200).json({
                status: 200,
                error: false,
                message: "User followed",
                followed: true,
              });
            })
            .catch((err) => {
              return res.status(500).json({
                status: 500,
                error: true,
                message: "Error following user" + err,
              });
            });
        }
      }
    })
    .catch((err) => {
      return res.status(404).json({
        status: 404,
        error: true,
        message: "User not found" + err,
      });
    });
});


// return list of followings from user id
router.get("/:uuid/following", authenticateToken, function (req, res, next) {
  let uuid = req.params.uuid;
  let user = req.user;
  let followingList = [];

  database
    .execute(
      "SELECT following FROM users WHERE id = ? ALLOW FILTERING",
      [UUID.fromString(uuid)],
      { prepare: true }
    )
    .then((result) => {
      let following = result.rows[0].following;

      following.forEach((follow) => {
        followingList.push(UUID.fromString(follow.toString()));
      });
    })
    .then(() => {
      // get following data
      database
        .execute(
          "SELECT id, username, displayname FROM users WHERE id IN ? ALLOW FILTERING",
          [followingList],
          { prepare: true }
        )
        .then((result) => {
          database
            .execute(
              "SELECT following FROM users WHERE id = ? ALLOW FILTERING",
              [UUID.fromString(user.id)],
              { prepare: true }
            )
            .then((result2) => {
              let userFollowing = result2.rows[0].following;
              
              let mutualFollowing = [];

              if(userFollowing != null) {
                mutualFollowing = followingList.filter((follow) => {
                  return userFollowing.some((userFollow) => {
                    return (
                      follow.buffer.toString("hex") ===
                      userFollow.buffer.toString("hex")
                    );
                  });
                });
              }

              return res.status(200).json({
                status: 200,
                error: false,
                data: {
                  following: result.rows,
                  mutuals: mutualFollowing,
                },
              });
            });
        })
        .catch((err) => {});
    })
    .catch((err) => {});
});

// return list of followers from user id
router.get("/:uuid/followers", authenticateToken, function (req, res, next) {
  let uuid = req.params.uuid;
  let user = req.user;
  let followersList = [];

  database
    .execute(
      "SELECT followers FROM users WHERE id = ? ALLOW FILTERING",
      [UUID.fromString(uuid)],
      { prepare: true }
    )
    .then((result) => {
      let followers = result.rows[0].followers;

      followers.forEach((follower) => {
        followersList.push(UUID.fromString(follower.toString()));
      });
    })
    .then(() => {
      // get followers data
      database
        .execute(
          "SELECT id, username, displayname FROM users WHERE id IN ? ALLOW FILTERING",
          [followersList],
          { prepare: true }
        )
        .then((result) => {
          database
            .execute(
              "SELECT following FROM users WHERE id = ? ALLOW FILTERING",
              [UUID.fromString(user.id)],
              { prepare: true }
            )
            .then((result2) => {
              let userFollowing = result2.rows[0].following;

              let mutualFollowing = [];

              if(userFollowing != null) {
                mutualFollowing = followersList.filter((follow) => {
                  return userFollowing.some((userFollow) => {
                    return (
                      follow.buffer.toString("hex") ===
                      userFollow.buffer.toString("hex")
                    );
                  });
                });
              }

              return res.status(200).json({
                status: 200,
                error: false,
                data: {
                  followers: result.rows,
                  mutuals: mutualFollowing,
                },
              });
            });
        })
        .catch((err) => {});
    })
    .catch((err) => {});
});




module.exports = router;
