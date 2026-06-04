/*
  leaderboard/scripts/leaderboard-core.js
  =========================================
  Core System — مشترك بين جميع البوتات
  المسؤولية: infrastructure, GitHub push, validation, save/update

  Reset Logic:
  - daily_points  تُصفَّر كل يوم الساعة 12:00 ليل بتوقيت مكة
  - weekly_points تُصفَّر كل خميس الساعة 12:00 ليل بتوقيت مكة
  - total_points  لا تُصفَّر أبداً

  كل روم يبقى منفصل تماماً — لا يوجد global leaderboard.
*/

/* ══════════════════════════════════════
   ROOM CONFIG
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
   GITHUB CONFIG
══════════════════════════════════════ */
var LB_GH = {
  token  : "ghp_XXXXXXXXXXXXXXXXXXXXXXXX",  /* ← Personal Access Token */
  owner  : "NexArab",
  repo   : "alkhaleej-tools",
  branch : "main"
};

/* ══════════════════════════════════════
   ENCODING
══════════════════════════════════════ */
function _toBase64(str){
  var bytes = new TextEncoder().encode(str);
  var binary = "";
  bytes.forEach(function(b){ binary += String.fromCharCode(b); });
  return btoa(binary);
}
function _fromBase64(b64){
  var binary = atob(b64);
  var bytes   = new Uint8Array(binary.length);
  for(var i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}
function _isGarbled(str){
  if(!str || typeof str !== "string") return true;
  return /[ÙØÂÆÎ-]/.test(str);
}
function _cleanPlayersData(players){
  if(!players || typeof players !== "object") return {};
  var clean = {};
  Object.keys(players).forEach(function(name){
    if(!_isGarbled(name)) clean[name] = players[name];
    else console.warn("[LB] removed garbled player:", name);
  });
  return clean;
}
function _cleanChampion(champ){
  if(!champ || !champ.name) return champ;
  if(_isGarbled(champ.name)){ console.warn("[LB] cleared garbled champion:", champ.name); return null; }
  return champ;
}

/* ══════════════════════════════════════
   TIME HELPERS — بتوقيت مكة
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

/*
  هل يجب تصفير daily_points؟
  نقارن تاريخ آخر reset يومي بتاريخ اليوم — إذا مختلفان → نصفّر
*/
function _needsDailyReset(data){
  var today = _meccaDate();
  var lastD = data.last_daily_reset ? data.last_daily_reset.slice(0,10) : null;
  return lastD !== today;
}

/*
  هل يجب تصفير weekly_points؟
  نتحقق إذا مرّ خميس كامل منذ آخر weekly reset
*/
function _needsWeeklyReset(data){
  var now   = _meccaNow();
  var lastW = data.last_weekly_reset ? data.last_weekly_reset.slice(0,10) : null;

  if(!lastW) return true;

  /* إيجاد آخر خميس ماضٍ (أو اليوم إذا كان خميساً) */
  var lastThursday = new Date(now);
  var dayOfWeek    = lastThursday.getDay(); /* 0=أحد, 4=خميس */
  var daysToSub    = (dayOfWeek >= 4) ? (dayOfWeek - 4) : (dayOfWeek + 3);
  lastThursday.setDate(lastThursday.getDate() - daysToSub);
  var lastThursdayDate = lastThursday.toLocaleDateString("sv-SE",{timeZone:"Asia/Riyadh"});

  /* إذا آخر weekly reset قبل آخر خميس → نصفّر */
  return lastW < lastThursdayDate;
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
function _ghPath(room){ return "leaderboard/data/"+room+".json"; }
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
    var raw  = _fromBase64(res.content.replace(/\n/g,""));
    var data = JSON.parse(raw);
    data.players         = _cleanPlayersData(data.players || {});
    data.weekly_champion = _cleanChampion(data.weekly_champion);
    data.daily_champion  = _cleanChampion(data.daily_champion);
    cb(null,data,res.sha);
  })
  .catch(cb);
}
function _ghPut(room, data, sha, msg, cb){
  var jsonStr = JSON.stringify(data, null, 2);
  var enc     = _toBase64(jsonStr);
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
   PLAYER HELPERS
══════════════════════════════════════ */
function _defaultPlayer(){
  return {
    weekly_points:0, daily_points:0, total_points:0,
    wins:0, participations:0, title:null, last_win:null, updated_at:null
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
    player.wins     = (player.wins||0) + 1;
    player.last_win = _meccaISO();
    player.title    = ROOM_CONFIG[room]&&ROOM_CONFIG[room].title || null;
  }
  return player;
}

/* ══════════════════════════════════════
   RESET LOGIC — يُطبَّق قبل إضافة النقاط
══════════════════════════════════════ */
function _applyResets(data, room){
  var players = data.players || {};
  var sorted;

  /* ── DAILY RESET ── */
  if(_needsDailyReset(data)){
    sorted = Object.entries(players)
      .filter(function(e){ return (e[1].daily_points||0) > 0; })
      .sort(function(a,b){ return (b[1].daily_points||0)-(a[1].daily_points||0); });

    if(sorted.length){
      data.daily_champion = {
        name   : sorted[0][0],
        points : sorted[0][1].daily_points||0,
        date   : _meccaDate()
      };
      data.daily_champion_set_at = _meccaISO();
    }

    Object.keys(players).forEach(function(n){
      if(players[n]) players[n].daily_points = 0;
    });

    data.last_daily_reset = _meccaISO();
    console.log("[LB] daily reset — room:", room, "date:", _meccaDate());
  }

  /* ── WEEKLY RESET ── */
  if(_needsWeeklyReset(data)){
    sorted = Object.entries(players)
      .filter(function(e){ return (e[1].weekly_points||0) > 0; })
      .sort(function(a,b){ return (b[1].weekly_points||0)-(a[1].weekly_points||0); });

    if(sorted.length){
      data.weekly_champion = {
        name    : sorted[0][0],
        points  : sorted[0][1].weekly_points||0,
        week_of : _meccaDate()
      };
      data.weekly_champion_set_at = _meccaISO();
    }

    Object.keys(players).forEach(function(n){
      if(players[n]) players[n].weekly_points = 0;
    });

    data.last_weekly_reset = _meccaISO();
    data.last_reset        = _meccaISO();
    console.log("[LB] weekly reset — room:", room);
  }

  data.players = players;
  return data;
}

/* ══════════════════════════════════════
   MATCH STORAGE — max 50
══════════════════════════════════════ */
var MAX_MATCHES = 50;
function _saveMatch(data, opts){
  if(!Array.isArray(data.matches)) data.matches = [];
  data.matches.unshift({
    type        : opts.type,
    winner      : _cleanName(opts.winner),
    participants: (opts.participants||[]).map(function(p){
      return {name:_cleanName(p.name), points:p.points||0};
    }),
    created_at  : _meccaISO()
  });
  if(data.matches.length > MAX_MATCHES)
    data.matches = data.matches.slice(0, MAX_MATCHES);
  return data;
}

/* ══════════════════════════════════════
   PUBLIC API
══════════════════════════════════════ */
var Leaderboard = {

  addMatch: function(opts, cb){
    var err = _validateMatch(opts);
    if(err){ console.error("[LB] validation error:", err); if(cb) cb(new Error(err)); return; }

    var room         = opts.room;
    var winner       = _cleanName(opts.winner);
    var type         = opts.type;
    var dist         = ROUND_POINTS[type];
    var participants = opts.participants||[];

    _ghGet(room, function(err, data, sha){
      if(err){ console.error("[LB] get error:", err.message||err); if(cb) cb(err); return; }
      if(!data.players) data.players = {};

      /* ✅ الريست أولاً — قبل إضافة أي نقاط */
      data = _applyResets(data, room);

      /* تحديث نقاط المشاركين */
      participants.forEach(function(p,i){
        var name = _cleanName(p.name);
        if(!name) return;
        var pts  = p.points || dist[i] || 0;
        var isW  = (name === winner);
        data.players[name] = _updatePlayer(data.players[name], pts, isW, room);
      });

      /* حفظ الجولة */
      data = _saveMatch(data, {type:type, winner:winner, participants:participants});
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

  getPoints: function(room, cb){
    _ghGet(room, function(err, data){ cb(err, data); });
  },

  setToken: function(token){ LB_GH.token = token; },

  cleanRoom: function(room, cb){
    if(!ROOM_CONFIG[room]){ console.error("[LB] unknown room:", room); return; }
    _ghGet(room, function(err, data, sha){
      if(err){ console.error("[LB] cleanRoom get error:", err); if(cb) cb(err); return; }
      var before = Object.keys(data.players||{}).length;
      data.players         = _cleanPlayersData(data.players||{});
      data.weekly_champion = _cleanChampion(data.weekly_champion);
      data.daily_champion  = _cleanChampion(data.daily_champion);
      if(Array.isArray(data.matches)){
        data.matches = data.matches.filter(function(m){
          return m && !_isGarbled(m.winner);
        }).map(function(m){
          if(Array.isArray(m.participants))
            m.participants = m.participants.filter(function(p){ return p && !_isGarbled(p.name); });
          return m;
        });
      }
      var after = Object.keys(data.players).length;
      console.log("[LB] cleanRoom:", room, "| players before:", before, "after:", after);
      _ghPut(room, data, sha, "cleanup: remove garbled players ["+room+"]", function(e){
        if(e) console.error("[LB] cleanRoom push error:", e);
        else  console.log("[LB] cleanRoom done:", room);
        if(cb) cb(e||null);
      });
    });
  }
};
