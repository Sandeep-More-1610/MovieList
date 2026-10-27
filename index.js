
import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import session from "express-session";
import env from "dotenv";
import { Passport } from "passport";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { Strategy } from "passport-local";
import { createFeaturesRouter } from "./features/router.js";


env.config();
const root = path.dirname(fileURLToPath(import.meta.url));

export function createApp(db, { sessionSecret = process.env.SECRET || randomBytes(32).toString("hex"), saltRounds = Number(process.env.SALT || 10) } = {}) {
if (!Number.isInteger(saltRounds) || saltRounds < 4 || saltRounds > 15) {
  throw new Error("SALT must be an integer between 4 and 15.");
}
const app = express();
const passport = new Passport();
app.set("views", path.join(root, "views"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(root, "public")));
app.use(express.json());
app.use(session({ secret: sessionSecret, resave: false, saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 24 * 7 } }));
app.use(passport.initialize());
app.use(passport.session());
// Fetch callers must receive JSON when their login expires.
app.use((req, res, next) => {
  if (req.method === "POST" && req.is("application/json") && !req.isAuthenticated()) {
    return res.status(401).json({ status: "unauthenticated" });
  }
  next();
});
app.use(createFeaturesRouter(db));
async function transaction(work) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
const validText = value => typeof value === "string" && value.trim().length > 0;
app.use((req, res, next) => {
  const movieRoutes = ["/recommend_movie", "/accept_recommendation", "/remove_recommendation", "/put_watched", "/watch_later_post", "/remove_watched", "/remove_watch_later"];
  if (req.method === "POST" && movieRoutes.includes(req.path) && !validText(req.body.name)) {
    return res.status(400).json({ status: "error", message: "Movie name is required." });
  }
  next();
});

app.get("/",async(req,res)=>{
  
  if(req.isAuthenticated()){
    res.redirect("/watched");
  }else{
    res.render("home.ejs");
  }

})

app.get("/register",(req,res)=>{
  const alert=req.session.alert;
  req.session.alert=null;
  res.render("register.ejs",{alert});
});

app.get("/login",(req,res)=>{
  res.render("login.ejs");
});


app.get("/watched",async(req,res)=>{
  if(req.isAuthenticated()){
    const email= req.user.email;//enter req.username maybe
    try{
      const movies=await db.query("SELECT * FROM watched WHERE email=$1",[email]);
      const mails=await db.query("SELECT email_2 FROM friends WHERE email_1=$1",[email]);

      const fr_req=await db.query("SELECT * FROM friend_request WHERE receiver=$1",[email]);

      const rec_mov=await db.query("SELECT * FROM recommendations WHERE receiver=$1 ;",[email]);

      res.render("watched.ejs", { movies: movies.rows, emails: mails.rows, friendRequests: fr_req.rows, recs: rec_mov.rows });
    }catch(error){
      console.log(error);
      res.status(500).send("Unable to load your movies. Please try again.");
    }
  }else{
    res.redirect("/");
  }
});


app.get("/watch_later",async(req,res)=>{
  if(req.isAuthenticated()){
    const email= req.user.email;//enter req.username maybe
    try{
      const movies=await db.query("SELECT * FROM watch_later WHERE email=$1",[email]);
      if(movies.rows.length > 0){
        res.render("watch_later.ejs",{movies:movies.rows});
      }else{
        res.render("watch_later.ejs");
      }      
    }catch(error){
      res.redirect("/");
      console.log(error);
    }
  }else{
    res.redirect("/");
  }
});

app.post("/login",passport.authenticate("local",{
  successRedirect:"/watched",
  failureRedirect:"/login",
}));

app.post("/register", async (req, res, next) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim() : "";
  const password = req.body.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !validText(password) || Buffer.byteLength(password) > 72) {
    return res.status(400).render("register.ejs", { alert: "Enter a valid email and a password of at most 72 bytes." });
  }
  try {
    const existing = await db.query("SELECT email FROM credentials WHERE email=$1", [email]);
    if (existing.rows.length) return res.status(409).render("register.ejs", { alert: "Email Exists!" });
    const hash = await bcrypt.hash(password, saltRounds);
    const result = await db.query("INSERT INTO credentials (email,password) VALUES ($1,$2) RETURNING *", [email, hash]);
    req.login(result.rows[0], err => err ? next(err) : res.redirect("/watched"));
  } catch (error) {
    if (error.code === "23505") return res.status(409).render("register.ejs", { alert: "Email Exists!" });
    next(error);
  }
});

app.get("/friends",async(req,res)=>{
  if(req.isAuthenticated()){
    const email= req.user.email;//enter req.username maybe
    try{
      const mails=await db.query("SELECT email FROM credentials WHERE email!=$1",[email]);
      
      if(mails.rows.length>0){
        res.render("friends.ejs",{friends:mails.rows});
        
      }else{
        res.render("friends.ejs");
      }
      


    }catch(error){
      console.log(error);
      res.redirect("/");
    }
  }else{
    res.redirect("/");
  }
})

app.post("/friend_req",async(req,res)=>{
  if(req.isAuthenticated()){
    const email= req.user.email;
    const friend=req.body.mail;

    try{
      if (!validText(friend) || friend === email) return res.status(400).json({ status: "error" });
      const target = await db.query("SELECT email FROM credentials WHERE email=$1", [friend]);
      if (!target.rows.length) return res.status(404).json({ status: "error" });
      const already=await db.query("SELECT * FROM friends WHERE (email_1 = $1 AND email_2 = $2) OR (email_1 = $2 AND email_2 = $1)",[friend,email]);
      const req_present=await db.query("SELECT * FROM friend_request WHERE (receiver=$1 AND sender=$2) OR (receiver=$2 AND sender=$1)",[friend,email]);
      if(already.rows.length>0){
        res.json({
          status:"present"
          
        })
      }else if(req_present.rows.length>0){
        res.json({
          status:"already"
        })
      }else{
        const result=await db.query("INSERT INTO friend_request (receiver,sender) VALUES ($1,$2) RETURNING *;",[friend,email]);
        res.json({
          status:"done"
        })
      }
      
    }catch(err){
      res.json({
        status:"error"
      })
  
    }
  
  }else{
    res.redirect("/");
  }
})
app.post("/accept_friend", async (req, res) => {
    if (req.isAuthenticated()) {
        const email = req.user.email;
        const mail = req.body.email;  

        try {
            const accepted = await transaction(async client => {
              const request = await client.query("DELETE FROM friend_request WHERE receiver=$1 AND sender=$2 RETURNING *", [email, mail]);
              if (!request.rowCount) return false;
              await client.query("INSERT INTO friends (email_1,email_2) VALUES ($1,$2) ON CONFLICT DO NOTHING", [email,mail]);
              await client.query("INSERT INTO friends (email_1,email_2) VALUES ($1,$2) ON CONFLICT DO NOTHING", [mail,email]);
              return true;
            });
            if (!accepted) return res.status(404).json({ status: "error" });

            res.json({
              status: "done" 
            });

        } catch (err) {
            console.error(err);
            res.json({
              status: "error" 
            });
        }
    } else {
        res.redirect("/");
    }
});


app.post("/remove_friend_request",async(req,res)=>{
  if(req.isAuthenticated()){
    const email=req.user.email;
    const mail=req.body.email;
    try{
      const result=await db.query("DELETE FROM friend_request WHERE receiver=$1 AND sender=$2;",[email,mail]);
      res.json({
        status:"done"
      })
    }catch(err){
      res.json({
        status:"error"
      })
    }  
  }else{
    res.redirect("/");
  }
})


app.post("/recommend_movie",async(req,res)=>{
  if(req.isAuthenticated()){
  const name=req.body.name;
  const poster=req.body.poster;
  const rec=req.body.email;
  const email=req.user.email;
  try{
    const friend = await db.query("SELECT email_2 FROM friends WHERE email_1=$1 AND email_2=$2", [email, rec]);
    if (!friend.rows.length) return res.status(403).json({ status: "error" });
    const result=await db.query("INSERT INTO recommendations (movie_name,poster,receiver,sender) VALUES ($1,$2,$3,$4) RETURNING *;",[name,poster,rec,email]);
    res.json({
      status:"done"
    })
  }catch(err){
    console.log(err);
    res.json({
      status:"error"
    })
  }
  }else{
    res.redirect("/");
  }
})

//complete this
app.post("/accept_recommendation",async(req,res)=>{
  if(req.isAuthenticated()){
    const email=req.user.email;
    const data=req.body;
    try{
      const status = await transaction(async client => {
        const recommendation = await client.query("SELECT * FROM recommendations WHERE movie_name=$1 AND receiver=$2", [data.name,email]);
        if (!recommendation.rows.length) return null;
        const later = await client.query("SELECT * FROM watch_later WHERE movie_name=$1 AND email=$2", [data.name,email]);
        const watched = await client.query("SELECT * FROM watched WHERE movie_name=$1 AND email=$2", [data.name,email]);
        const present = later.rows.length || watched.rows.length;
        if (!present) await client.query("INSERT INTO watch_later (movie_name,email,poster) VALUES ($1,$2,$3)", [data.name,email,recommendation.rows[0].poster]);
        await client.query("DELETE FROM recommendations WHERE movie_name=$1 AND receiver=$2", [data.name,email]);
        return present ? "present" : "done";
      });
      if (!status) return res.status(404).json({ status: "error" });
      res.json({ status });
    }catch(err){
      console.log(err);
      res.json({
        status:"error"
      })
    }
  }else{
    res.redirect("/");
  }
})
//complete this
app.post("/remove_recommendation",async(req,res)=>{
  if(req.isAuthenticated()){
    const email=req.user.email;
    const data=req.body;
    try{
      await db.query("DELETE FROM recommendations WHERE movie_name=$1 AND receiver=$2",[data.name,email]);
      res.json({
        status:"done"
      })
    }catch(err){
      res.json({
        status:"error"
      })
    }
  }else{
    res.redirect("/");
  }
})

//check this code it can be redundant
app.get("/search",async(req,res)=>{
  if(req.isAuthenticated()){
    res.render("search.ejs");
  }else{
    res.redirect("/");
  }
})
//till here
app.post("/search",async(req,res)=>{
  if(req.isAuthenticated()){
    const query = typeof req.body.search === "string" ? req.body.search.trim() : "";
    if (!query) return res.status(400).render("search.ejs", { error: "Enter a movie name." });
    try{
      const result = await fetch(
        `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}`,
        {
          method: "GET",
          signal: AbortSignal.timeout(10000),
          headers: {
            Authorization: `Bearer ${process.env.TMDB_TOKEN}`,
            Accept: "application/json",
          },
        }
      );
      /*const result=await fetch(`https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}`,{
        headers : {
          Authorization:`Bearer ${process.env.TMDB_TOKEN}`,"Content-Type":"application/json"
      }})*/
      if (!result.ok) throw new Error(`Movie search failed (${result.status})`);
      const unrefinedData=await result.json();
      if (unrefinedData.results?.length > 0) {
        const movies = unrefinedData.results.sort((a, b) => b.popularity - a.popularity);
        res.render("search.ejs",{movies:movies});
      }else{
        res.render("search.ejs",{error:"Error: Wrong Movie Name!"});
      }      

    }catch(error){
      console.log(error);
      res.render("search.ejs",{error:"OOPS! Nothing to Show HERE!"});
    }
  }else{
    res.redirect("/");
  }
});

app.post("/put_watched",async(req,res)=>{
  if(req.isAuthenticated()){
    try{
      const status = await transaction(async client => {
        const existing = await client.query("SELECT * FROM watched WHERE email=$1 AND movie_name=$2", [req.user.email,req.body.name]);
        if (!existing.rows.length) await client.query("INSERT INTO watched (movie_name,email,poster) VALUES ($1,$2,$3)", [req.body.name,req.user.email,req.body.poster || ""]);
        await client.query("DELETE FROM watch_later WHERE email=$1 AND movie_name=$2", [req.user.email,req.body.name]);
        return existing.rows.length ? "present" : "done";
      });
      res.json({ status });
    }catch(error){
      console.log(error);
      res.json({
        status:"error"
      });
    }
  }else{
    res.redirect("/");
  }

});
app.post("/watch_later_post",async(req,res)=>{
  if(req.isAuthenticated()){
    try{
      //working here
      const result1=await db.query("SELECT * FROM watched WHERE email=$1 AND movie_name=$2",[req.user.email, req.body.name]);
      const result2=await db.query("SELECT * FROM watch_later WHERE email=$1 AND movie_name=$2",[req.user.email, req.body.name]);
      var res1=result1.rows.length;
      var res2=result2.rows.length;
      if(!res1>0 && !res2>0){
        res1=await db.query("INSERT INTO watch_later (movie_name,email,poster) VALUES ($1, $2, $3) RETURNING *;",[req.body.name, req.user.email, req.body.poster]);
        res.json({
          status:"done"
        });
      }else if(res2>0){
        res.json({
          status:"present"
        })
      }else{
        res.json({
          status:"watched"
        })
      }
    }catch(error){
      console.log(error);
      res.json({
        status:"error"
      })
    }
  }else{
    res.redirect("/");
  }
})
app.post("/remove_watched",async(req,res)=>{
  if(req.isAuthenticated()){
    try{
      const result=await db.query("DELETE FROM watched WHERE email=$1 AND movie_name=$2 RETURNING *",[req.user.email, req.body.name]);
      if(result.rowCount>0){
        res.json({
          status:"done"
        })
      }else{
        res.json({
          status:"bad_error"
        })
      }
    }catch(error){
      res.json({
        status:"error"
      })
    }
    
  }else{
    res.redirect("/");
  }
})
app.post("/remove_watch_later",async(req,res)=>{
  if(req.isAuthenticated()){
    try{
      const result=await db.query("DELETE FROM watch_later WHERE email=$1 AND movie_name=$2 RETURNING *",[req.user.email, req.body.name]);
      if(result.rowCount>0){
        res.json({
          status:"done"
        })
      }else{
        res.json({
          status:"bad_error"
        })
      }
    }catch(error){
      res.json({
        status:"error"
      })
    }
  }else{
    res.redirect("/");
  }
})




passport.use(
  new Strategy(async function verify(username, password, cb) {
    try {
      const result = await db.query("SELECT * FROM credentials WHERE email = $1", [username]);
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const storedHashedPassword = user.password;
        bcrypt.compare(password, storedHashedPassword, (err, valid) => {
          if (err) {
            //Error with password check
            console.error("Error comparing passwords:", err);
            return cb(err);
          } else {
            if (valid) {
              //Passed password check
              return cb(null, user);
            } else {
              //Did not pass password check
              return cb(null, false);
            }
          }
        });
      } else {  
        return cb(null, false);
      }
    } catch (err) {
      return cb(err);
    }
  })
);



passport.serializeUser((user, cb) => cb(null, user.email));
passport.deserializeUser(async (email, cb) => {
  try {
    const result = await db.query("SELECT email FROM credentials WHERE email=$1", [email]);
    cb(null, result.rows[0] || false);
  } catch (error) { cb(error); }
});
app.use((err, req, res, next) => {
  console.error(err.message);
  if (res.headersSent) return next(err);
  if (req.is("application/json")) return res.status(500).json({ status: "error" });
  res.status(500).send("Something went wrong. Please try again.");
});
return app;
}

export async function start() {
  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    user: process.env.DB_USER || process.env.USER,
    host: process.env.DB_HOST || process.env.HOST,
    database: process.env.DB_NAME || process.env.DATABASE,
    password: process.env.DB_PASSWORD || process.env.PASSWORD,
    port: Number(process.env.DB_PORT || 5432),
    connectionTimeoutMillis: 5000,
  });
  db.on("error", err => console.error("Database connection error:", err.message));
  try {
    await db.query("SELECT 1");
    return createApp(db).listen(process.env.PORT || 3000, () => console.log(`Server running on port ${process.env.PORT || 3000}`));
  } catch (error) {
    await db.end();
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  start().catch(err => { console.error("Startup failed. Check PostgreSQL and your .env configuration:", err.message || err.code || "Database connection refused"); process.exitCode = 1; });
}
