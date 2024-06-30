require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const nunjucks = require("nunjucks");
const { nanoid } = require("nanoid");
const cookie = require("cookie");
const crypto = require("crypto");
const WebSocket = require("ws");
const http = require("http");

const { MongoClient, ObjectId } = require("mongodb");

const app = express();
app.use(express.static("public"));
app.set("view engine", "njk");

nunjucks.configure("views", {
  autoescape: true,
  express: app,
  tags: {
    blockStart: "[%",
    blockEnd: "%]",
    variableStart: "[[",
    variableEnd: "]]",
    commentStart: "[#",
    commentEnd: "#]",
  },
});

app.use(express.json());
app.use(cookieParser());

const clientPromise = MongoClient.connect(process.env.DB_URI, {
  useUnifiedTopology: true,
  minPoolSize: 10,
});

let DB;
app.use(async (req, res, next) => {
  try {
    const client = await clientPromise;
    const db = client.db("users");
    req.db = db;
    DB = db;
    next();
  } catch (error) {
    next(error);
  }
});

const clients = new Map();

const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true, clientTracking: false });

const auth = () => async (req, res, next) => {
  if (!req.cookies.sessionId) {
    return next();
  }

  const user = await findUserBySessionId(req.db, req.cookies.sessionId);
  if (!user) {
    return next();
  }
  req.user = user;
  req.sessionId = req.cookies.sessionId;
  next();
};

const findUserByUsername = async (db, username) => {
  const user = await db.collection("users").findOne({ username });
  return user;
};

const findUserBySessionId = async (db, sessionId) => {
  const session = await db.collection("sessions").findOne(
    { sessionId },
    {
      projection: { userID: 1 },
    }
  );
  if (!session) {
    return null;
  }

  return db.collection("users").findOne({ _id: new ObjectId(session.userID) });
};

const createSession = async (db, userID) => {
  const sessionId = nanoid();

  await db.collection("sessions").insertOne({ userID, sessionId });

  return sessionId;
};

const deleteSession = async (db, sessionId) => {
  await db.collection("sessions").deleteOne({ sessionId });
};

function hashPassword(password) {
  const hash = crypto.createHash("sha256");

  hash.update(password);
  const hashedPassword = hash.digest("hex");

  return hashedPassword;
}

app.get("/", auth(), (req, res) => {
  // console.log(req, 'погнали');
  // wss.on("connection", (ws, req) => {
  //   console.log("new connection");
  //   clients.set(req.socket.remoteAddress, ws);
  //   ws.on("close", () => {
  //     clients.delete(req.socket.remoteAddress);
  //   });
  // });
  // console.log(req.user, 'user в /');
  res.render("index", {
    user: req.user,
    authError: req.query.authError === "true" ? "Wrong username or password" : req.query.authError,
  });
});

app.post("/login", bodyParser.urlencoded({ extended: false }), async (req, res) => {
  const { username, password } = req.body;
  const user = await findUserByUsername(req.db, username);
  if (!user) {
    return res.status(401).redirect("/?authError=true");
  } else if (user.password !== hashPassword(password)) {
    return res.status(401).redirect("/?authError=true");
  }

  const sessionId = await createSession(req.db, user._id);
  res.cookie("sessionId", sessionId, { httpOnly: true }).redirect("/");
});

app.post("/signup", bodyParser.urlencoded({ extended: false }), async (req, res) => {
  const { username, password } = req.body;
  const user = await findUserByUsername(req.db, username);
  if (user) {
    return res.redirect("/?authError=true");
  } else {
    req.db.collection("users").insertOne({ username, password: hashPassword(password) });
    res.status(201).redirect("/");
  }
});

app.get("/logout", auth(), async (req, res) => {
  if (!req.user) {
    return res.redirect("/");
  }
  await deleteSession(req.db, req.sessionId);
  res.clearCookie("sessionId").redirect("/");
});

server.on("upgrade", async (req, socket, head) => {
  const cookies = cookie.parse(req.headers.cookie || "");
  const userID = await findUserBySessionId(DB, cookies.sessionId);

  if (!userID) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  req.userId = userID._id;
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, { id: userID._id });
  });
});

wss.on("connection", (ws, req) => {
  const { id } = req;
  clients.set(id, ws);
  ws.on("message", async (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (error) {
      console.error(error);
      return;
    }

    if (data) {
      let fullMessage;
      if (data.job === "all_timers") {
        const timer = await DB.collection("timers").find({}).toArray();
        fullMessage = JSON.stringify({
          job: "all_timers",
          timers: timer.map((timer) => {
            return {
              ...timer,
              id: timer._id.toString(),
              start: parseInt(timer.start),
              progress: Date.now() - timer.start,
              end: !timer.isActive ? parseInt(timer.end) : null,
              duration: !timer.isActive ? timer.end - timer.start : null,
            };
          }),
        });
      }

      if (data.job === "create_timer") {
        const description = data.description;
        try {
          const timer = await DB.collection("timers").insertOne({
            description,
            start: Date.now(),
            isActive: true,
          });
          fullMessage = JSON.stringify({ job: "create_timer", timer: timer });
        } catch (error) {
          console.error(error);
          return;
        }
      }

      if (data.job === "active_timers") {
        const timer = await DB.collection("timers").find({ isActive: true }).toArray();
        fullMessage = JSON.stringify({
          job: "active_timers",
          timers: timer.map((timer) => {
            return {
              ...timer,
              id: timer._id.toString(),
              start: parseInt(timer.start),
              progress: Date.now() - timer.start,
              end: !timer.isActive ? parseInt(timer.end) : null,
              duration: !timer.isActive ? timer.end - timer.start : null,
            };
          }),
          // timers: timer.map((timer) => {
          //   return {
          //     ...timer,
          //     id: timer._id.toString(),
          //     start: parseInt(timer.start),
          //     progress: Date.now() - timer.start,
          //     end: !timer.isActive ? parseInt(timer.end) : null,
          //     duration: !timer.isActive ? timer.end - timer.start : null,
          //   };
          // })
        });
      }

      // for (const client of clients.values()) {
      //   return client.send(JSON.stringify(fullMessage));
      // }
      if (data.job === "userID") {
        try {
          const user = await DB.collection("users").findOne({ _id: new ObjectId(id) });
          fullMessage = JSON.stringify({
            job: "userID",
            id: id,
            name: user.username,
          });
        } catch (error) {
          console.error(error);
          return;
        }
      }
      if (data.job === "stop_timer") {
        try {
          await DB.collection("timers").findOneAndUpdate(
            { _id: new ObjectId(data.id) },
            {
              $set: {
                end: Date.now(),
                isActive: false,
              },
            },
            {
              returnOriginal: false,
            }
          );
          fullMessage = JSON.stringify({ job: "stop_timer" });
        } catch (error) {
          console.error(error);
          return;
        }
      }

      for (const client of clients.values()) {
        client.send(fullMessage);
      }
    }
  });
  ws.on("close", () => {
    clients.delete(id);
  });
});

// app.get("/api/timers", auth(), async (req, res) => {
//   const isActive = req.query.isActive === "true";
//   const timer = await req.db.collection("timers").find({ isActive }).toArray();
//   const timers = timer.map((timer) => {
//     return {
//       ...timer,
//       id: timer._id.toString(),
//       start: parseInt(timer.start),
//       progress: Date.now() - timer.start,
//       end: !isActive ? parseInt(timer.end) : null,
//       duration: !isActive ? timer.end - timer.start : null,
//     };
//   })
//   res.status(200).json(timers);
// });

// app.post("/api/timers", auth(), async (req, res) => {
//   const description = req.body.description;
//   const timer = await req.db.collection("timers")
//     .insertOne(
//       {
//         start: Date.now(),
//         description,
//         isActive: true,
//       }
//     )

//   res.json(timer);
// });

// app.post("/api/timers/:id/stop", auth(), async (req, res) => {
//   const id = req.params.id;
//   const timer = await req.db.collection("timers").findOneAndUpdate({ _id: new ObjectId(id) },
//     {
//       $set: {
//         end: Date.now(),
//         isActive: false,
//       },
//     },
//     {
//       returnOriginal: false
//     }
//   );
//   if (!timer) {
//     res.status(404).send("Not found");
//     return;
//   }

//   res.json(timer);
// });

const port = process.env.PORT || 3000;

server.listen(port, () => {
  console.log(`Server started on port http://localhost:${port}`);
});

// app.listen(port, () => {
//   console.log(`  Listening on http://localhost:${port}`);
// });
