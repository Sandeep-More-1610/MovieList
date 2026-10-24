
import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import session from "express-session";
import env from "dotenv";
import passport from "passport";
import { Strategy } from "passport-local";
import { createFeaturesRouter } from "./features/router.js";


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
app.use(createFeaturesRouter(db)); // Tonight's Pick + Where to Stream



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

      if(movies.rows.length > 0){
        res.render("watched.ejs",{movies:movies.rows || [],emails:mails.rows || [],friendRequests:fr_req.rows || [],recs:rec_mov.rows || []});
        
      }else{
        res.render("watched.ejs");
      }
      
    }catch(error){
      console.log(error);
      res.redirect("/");
      
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
      const already=await db.query("SELECT * FROM friends WHERE (email_1 = $1 AND email_2 = $2) OR (email_1 = $2 AND email_2 = $1)",[friend,email]);
      const req_present=await db.query("SELECT * FROM friend_request WHERE receiver=$1 AND sender=$2",[friend,email]);
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
            // Start a Transaction
            await db.query("BEGIN");
            await db.query("INSERT INTO friends (email_1, email_2) VALUES ($1, $2)", [email, mail]); 
            await db.query("INSERT INTO friends (email_1, email_2) VALUES ($2, $1)", [email, mail]);
            await db.query("DELETE FROM friend_request WHERE receiver=$1 AND sender=$2", [email, mail]);
            // Commit the changes
            await db.query("COMMIT");

            res.json({
              status: "done" 
            });

        } catch (err) {
            await db.query("ROLLBACK");
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
      const res1=await db.query("SELECT * FROM watch_later WHERE movie_name=$1 AND email=$2",[data.name,email]);
      const res2=await db.query("SELECT * FROM watched WHERE movie_name=$1 AND email=$2",[data.name,email]);
      if(res1.rows.length>0 || res2.rows.length>0){
        await db.query("DELETE FROM recommendations WHERE movie_name=$1 AND receiver=$2",[data.name,email]);
        res.json({
          status:"present"
        })
      }else{
        await db.query("BEGIN");
        await db.query("INSERT INTO watch_later (movie_name,email,poster) VALUES ($1,$2,$3)",[data.name,email,data.poster]);
        await db.query("DELETE FROM recommendations WHERE movie_name=$1 AND receiver=$2",[data.name,email]);
        await db.query("COMMIT");
        res.json({
          status:"done"
        })
      }
      
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




//make this
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
