
import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import session from "express-session";
import env from "dotenv";
import passport from "passport";
import { Strategy } from "passport-local";


const app=express();
env.config();
const PORT= process.env.PORT || 3000;
const saltRounds=parseInt(process.env.SALT);



app.use(bodyParser.urlencoded({extended:true}));
app.use(express.static("public"));
app.use(express.json());

app.use(session({
  secret:`${process.env.SECRET}`,
  resave: false,
  saveUninitialized: false,//if problem->do true
  cookie:{
    secure:false,//if problem-> remove
    maxAge:1000*60*60*24*7,//this wont work if the server shuts down
  }
}))
console.log(process.env.SECRET)
//we have to get the session started before we move further to passport initialization

app.use(passport.initialize());
app.use(passport.session());

const db = new pg.Client({
  user: process.env.USER,
  host: process.env.HOST,
  database: process.env.DATABASE,
  password: process.env.PASSWORD,
  port: 5432,
});

db.connect();



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
      
      if(movies.rows.length > 0){
        res.render("watched.ejs",{movies:movies.rows});
      }else{
        res.render("watched.ejs");
      }
      
    }catch(error){
      console.log(error);
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

app.post("/register",async(req,res)=>{
  const email=req.body.email;
  const password=req.body.password;
  try{  
    const checkEmail=await db.query("SELECT * FROM credentials WHERE email=$1",[email]);
    if(checkEmail.rows.length>0){
      req.session.alert="Email Exists!";
      res.redirect("/register");
    }else{
      bcrypt.hash(password,saltRounds,async(err,hash)=>{
        if(err){
          console.log("Error Hashing password: ",err);
        }else{
          const result=await db.query("INSERT INTO credentials (email,password) VALUES ($1, $2) RETURNING *;",[email,hash]);
          const user=result.rows[0];
          req.login(user, function(err) {
            if (err) { return next(err); }
            return res.redirect("/");
          });
        }
      })
      
    }
    
  }catch(error){
    console.log(error);
  }
});

app.get("/search",async(req,res)=>{
  if(req.isAuthenticated()){
    res.render("search.ejs");
  }else{
    res.redirect("/");
  }
})
app.post("/search",async(req,res)=>{
  if(req.isAuthenticated()){
    const query=req.body.search;
    try{
      const result = await fetch(
        `https://api.themoviedb.org/3/search/movie?query=${query}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${process.env.TMDB_TOKEN}`,
            Accept: "application/json",
          },
        }
      );
      /*const result=await fetch(`https://api.themoviedb.org/3/search/movie?query=${query}`,{
        headers : {
          Authorization:`Bearer ${process.env.TMDB_TOKEN}`,"Content-Type":"application/json"
      }})*/
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
      //work on this
      const result1=await db.query("SELECT * FROM watched WHERE email=$1 AND movie_name=$2",[req.user.email, req.body.name]);
      var res1=result1.rows.length;
      if(!res1>0){
        var result=await db.query("INSERT INTO watched (movie_name,email,poster) VALUES ($1, $2, $3) RETURNING *;",[req.body.name, req.user.email, req.body.poster]);
        //all movies will come in result.rows and to see if it is inserter check for result.rows.length>0 if yes then inserted successfully
        db.query("DELETE FROM watch_later WHERE email=$1 AND movie_name=$2",[req.user.email, req.body.name]);
        res.json({
          status:"done"
        })
      }else{
        res.json({
          status:"present"
        });
      }
      
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

app.post("/recommend_movie",async(req,res)=>{
  if(req.isAuthenticated()){
    console.log(req.user);
    console.log(req.body);
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
        return cb("User not found");
      }
    } catch (err) {
      console.log(err);
    }
  })
);



passport.serializeUser((user, cb) => {
  cb(null, user);
});
passport.deserializeUser((user, cb) => {
  cb(null, user);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
