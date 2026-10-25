"use strict";
const fs=require("node:fs"),path=require("node:path");
const {folder,read,write}=require("./store.cjs");
const RELEASE="5.5",PROTOCOL=55;
const EDITION=fs.existsSync(path.resolve(__dirname,"../../CLOUD-ONLY.json"))?"cloud":"desktop";
function requireProfile(profile,{create=false}={}){
  const dir=path.resolve(profile),marker=path.join(dir,"application-release.json");
  const stamp=read(marker,null);
  if(stamp){if(stamp.release!==RELEASE)throw Error("5.5 refuses profiles belonging to another branch");if((stamp.edition||"desktop")!==EDITION)throw Error("Cloud and desktop editions require separate profiles");return dir;}
  if(!create)throw Error("A dedicated 5.5 profile is required; old branch profiles cannot be opened");
  if(fs.existsSync(dir)&&fs.readdirSync(dir).length)throw Error("5.5 requires a fresh directory; existing branch data will not be imported or changed");
  folder(dir);write(marker,{release:RELEASE,protocol:PROTOCOL,edition:EDITION});return dir;
}
module.exports={RELEASE,PROTOCOL,EDITION,requireProfile};
