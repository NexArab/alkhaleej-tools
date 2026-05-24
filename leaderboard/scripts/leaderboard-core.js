/*
  leaderboard/scripts/leaderboard-core.js
  =========================================
  Core System — مشترك بين جميع البوتات
  المسؤولية: infrastructure, GitHub push, validation, save/update

  كل روم يبقى منفصل تماماً — لا يوجد global leaderboard.
  الاستخدام:
    Leaderboard.addMatch({ room:"maqalat", winner:"أحمد", participants:[...], type:5 });
*/

/* ══════════════════════════════════════
   ROOM CONFIG — مركزي لكل الرومات
══════════════════════════════════════ */
var ROOM_CONFIG = {
  maqalat:   { title: "ملك المقالات",       icon: "📝" },
  musabaqat: { title: "سيد المسابقات",      icon: "🎯" },
  faaaliyat: { title: "بطل الفعاليات",      icon: "🎉" },
  lugha:     { title: "أسطورة لغة الضاد",   icon: "📚" }
};

/* ══════════════════════════════════════
   POINTS DISTRIBUTION
══════════════════════════════════════ */
var ROUND_POINTS = {
  5:  [5,4,3,2,1],
  10: [10,8,6,4,2],
  15: [15,12,9,6,3],
  20: [20,16,12,8,4],
  25: [25,20,15,10,5]
};

/* ══════════════════════════════════════
   GITHUB CONFIG — يُضبط مرة واحدة
══════════════════════════════════════ */
var LB_GH = {
  token  : "ghp_XXXXXXXXXXXXXXXXXXXXXXXX",  /* ← Personal Access Token */
  owner  : "NexArab",
  repo   : "alkhaleej-tools",
  branch : "main"
};

/* ══════════════════════════════════════
   TIME HELPERS
══════════════════════════════════════ */
function _meccaNow(){
  return new Date(new Date().toLocaleString("en-US",{timeZone:"Asia/Riyadh"}));
}
function _meccaISO(){
  return new Date().toLocaleString("sv-SE",{timeZone:"Asia/Riyadh"}).replace(" ","T");
}
function _meccaDate(){
  return _meccaISO().slice(0,10);
}
function _isWeeklyReset(){
  var d=_meccaNow();
  return d.getDay()===4 && d.getHours()===0 && d.getMinutes()<5;
}
function _isDailyReset(){
  var d=_meccaNow();
  return d.getHours()===23 && d.getMinutes()<5;
}

/* ══════════════════════════════════════
   VALIDATION
══════════════════════════════════════ */
function _validateMatch(opts){
  if(!opts || typeof opts !== "object") return "opts missing";
  if(!ROOM_CONFIG[opts.room])           return "unknown room: "+opts.room;
  if(!ROUND_POINTS[opts.type])          return "unknown round type: "+opts.type;
  if(typeof opts.winner !== "string" || !opts.winner.trim()) return "invalid winner";
  if(!Array.isArray(opts.participants) || !opts.participants.length) return "no participants";
  return null;
}

function _cleanName(n){
  return String(n||"").replace(/[<>&"']/g,"").trim().slice(0,60);
}

/* ══════════════════════════════════════
   GITHUB API
══════════════════════════════════════ */
function _ghPath(room){
  return "leaderboard/data/"+room+".json";
}
function _ghHeaders(){
  return {
    "Authorization":"Bearer "+LB_GH.token,
    "Accept":"application/vnd.github.v3+json",
    "Content-Type":"application/json"
  };
}
function _ghGet(room, cb){
  var url = "https://api.github.com/repos/"+LB_GH.owner+"/"+LB_GH.repo
           +"/contents/"+_ghPath(room)+"?ref="+LB_GH.branch;
  fetch(url,{headers:_ghHeaders()})
  .then(function(r){return r.json();})
  .then(function(res){
    if(res.message){cb(new Error(res.message),null,null);return;}
    var data = JSON.parse(atob(res.content.replace(/\n/g,"")));
    cb(null,data,res.sha);
  })
  .catch(cb);
}
function _ghPut(room, data, sha, msg, cb){
  var enc = btoa(unescape(encodeURIComponent(JSON.stringify(data,null,2))));
  fetch("https://api.github.com/repos/"+LB_GH.owner+"/"+LB_GH.repo+"/contents/"+_ghPath(room),{
    method:"PUT",
    headers:_ghHeaders(),
    body:JSON.stringify({message:msg, content:enc, sha:sha, branch:LB_GH.branch})
  })
  .then(function(r){return r.json();})
  .then(function(res){if(cb) cb(null,res);})
  .catch(function(e){if(cb) cb(e,null);});
}

/* ══════════════════════════════════════
   PLAYER OBJECT HELPERS
══════════════════════════════════════ */
function _defaultPlayer(){
  return {
    weekly_points:0,
    daily_points:0,
    total_points:0,
    wins:0,
    participations:0,
    title:null,
    last_win:null,
    updated_at:null
  };
}

function _updatePlayer(player, pts, isWinner, room){
  if(!player) player = _defaultPlayer();
  player.weekly_points  = (player.weekly_points||0) + pts;
  player.daily_points   = (player.daily_points||0)  + pts;
  player.total_points   = (player.total_points||0)  + pts;
  player.participations = (player.participations||0) + 1;
  player.updated_at     = _meccaISO();
  if(isWinner){
    player.wins = (player.wins||0) + 1;
    player.last_win = _meccaISO();
    player.title = ROOM_CONFIG[room]&&ROOM_CONFIG[room].title || null;
  }
  return player;
}

/* ══════════════════════════════════════
   WEEKLY / DAILY RESET
══════════════════════════════════════ */
function _applyResets(data, room){
  var sorted;

  /* daily: 11 مساء — تسجيل بطل اليوم + تصفير daily_points */
  if(_isDailyReset()){
    sorted = Object.entries(data.players||{})
      .sort(function(a,b){return (b[1].daily_points||0)-(a[1].daily_points||0);});
    if(sorted.length){
      data.daily_champion = {
        name:sorted[0][0],
        points:sorted[0][1].daily_points||0,
        date:_meccaDate()
      };
      data.daily_champion_set_at = _meccaISO();
    }
    /* reset daily_points لكل اللاعبين */
    Object.keys(data.players||{}).forEach(function(n){
      if(data.players[n]) data.players[n].daily_points = 0;
    });
  }

  /* weekly: خميس 12 ليل — بطل الأسبوع + تصفير weekly_points */
  if(_isWeeklyReset()){
    sorted = Object.entries(data.players||{})
      .sort(function(a,b){return (b[1].weekly_points||0)-(a[1].weekly_points||0);});
    if(sorted.length){
      data.weekly_champion = {
        name:sorted[0][0],
        points:sorted[0][1].weekly_points||0,
        week_of:_meccaDate()
      };
      data.weekly_champion_set_at = _meccaISO();
    }
    /* reset weekly_points فقط — total_points تبقى */
    Object.keys(data.players||{}).forEach(function(n){
      if(data.players[n]) data.players[n].weekly_points = 0;
    });
    data.last_reset = _meccaISO();
    console.log("[LB] weekly reset — room:", room);
  }

  return data;
}

/* ══════════════════════════════════════
   MATCH STORAGE — max 50 matches
══════════════════════════════════════ */
var MAX_MATCHES = 50;

function _saveMatch(data, opts){
  if(!Array.isArray(data.matches)) data.matches = [];
  data.matches.unshift({
    type       : opts.type,
    winner     : _cleanName(opts.winner),
    participants: (opts.participants||[]).map(function(p){
      return {name:_cleanName(p.name), points:p.points||0};
    }),
    created_at : _meccaISO()
  });
  if(data.matches.length > MAX_MATCHES)
    data.matches = data.matches.slice(0, MAX_MATCHES);
  return data;
}

/* ══════════════════════════════════════
   PUBLIC API — Leaderboard
══════════════════════════════════════ */
var Leaderboard = {

  /*
    addMatch(opts, cb?)
    opts: { room, type, winner, participants:[{name,points},...] }
    cb: optional function(err)
  */
  addMatch: function(opts, cb){
    var err = _validateMatch(opts);
    if(err){ console.error("[LB] validation error:", err); if(cb) cb(new Error(err)); return; }

    var room        = opts.room;
    var winner      = _cleanName(opts.winner);
    var type        = opts.type;
    var dist        = ROUND_POINTS[type];
    var participants= opts.participants||[];

    _ghGet(room, function(err, data, sha){
      if(err){ console.error("[LB] get error:", err.message||err); if(cb) cb(err); return; }

      if(!data.players) data.players = {};

      /* تحديث نقاط كل مشارك */
      participants.forEach(function(p,i){
        var name = _cleanName(p.name);
        if(!name) return;
        var pts  = p.points || dist[i] || 0;
        var isW  = (name === winner);
        data.players[name] = _updatePlayer(data.players[name], pts, isW, room);
      });

      /* حفظ الجولة */
      data = _saveMatch(data, {type:type, winner:winner, participants:participants});

      /* resets */
      data = _applyResets(data, room);

      data.last_updated = _meccaISO();

      _ghPut(room, data, sha,
        "match: "+room+" | winner:"+winner+" type:"+type,
        function(e){
          if(e) console.error("[LB] push error:", e);
          else  console.log("[LB] match saved —", room, winner, type);
          if(cb) cb(e||null);
        }
      );
    });
  },

  /* للقراءة فقط — يُستخدم بالبوت إذا احتاج */
  getPoints: function(room, cb){
    _ghGet(room, function(err, data){ cb(err, data); });
  },

  /* تغيير التوكن من البوت */
  setToken: function(token){ LB_GH.token = token; }
};
