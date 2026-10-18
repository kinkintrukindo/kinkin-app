import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
let lastSceneKey='';
const canvas=document.querySelector('#logistics-world'),scene=new T.Scene();scene.background=new T.Color('#e8e7df');scene.fog=new T.Fog('#e8e7df',100,220);
const renderer=new T.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth<700?1.25:1.75));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;renderer.setClearColor('#e8e7df');
const camera=new T.PerspectiveCamera(35,1,.1,350);scene.add(new T.HemisphereLight(0xffffff,0x8c9680,2.3));const sun=new T.DirectionalLight(0xfff5de,3);sun.position.set(15,50,30);sun.castShadow=true;sun.shadow.mapSize.set(innerWidth<700?1024:2048,innerWidth<700?1024:2048);Object.assign(sun.shadow.camera,{left:-70,right:70,top:45,bottom:-45,far:150});sun.shadow.normalBias=.04;scene.add(sun);
const boxGeometries=new Map();function boxGeometry(w,h,d){const key=[w,h,d].join(':');if(!boxGeometries.has(key))boxGeometries.set(key,Math.min(w,h,d)>.28?new RoundedBoxGeometry(w,h,d,2,Math.min(.13,Math.min(w,h,d)*.12)):new T.BoxGeometry(w,h,d));return boxGeometries.get(key)}
const mats={};function mat(c){return mats[c]??=new T.MeshStandardMaterial({color:c,roughness:.55})}function box(parent,x,y,z,w,h,d,c){let m=new T.Mesh(boxGeometry(w,h,d),mat(c));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m}function group(x=0,y=0,z=0){let g=new T.Group();g.position.set(x,y,z);scene.add(g);return g}function cyl(g,x,y,z,r,h,c){let m=new T.Mesh(new T.CylinderGeometry(r,r,h,24),mat(c));m.position.set(x,y,z);m.castShadow=true;g.add(m);return m}
const logo=new T.TextureLoader().load('/assets/logo-cutout.png',()=>{lastSceneKey=''});logo.colorSpace=T.SRGBColorSpace;function branding(g,x,y,z,size,flip=false){let plane=new T.Mesh(new T.PlaneGeometry(size,size),new T.MeshStandardMaterial({map:logo,transparent:true,depthWrite:false,roughness:.8}));plane.position.set(x,y,z);if(flip)plane.rotation.y=Math.PI;g.add(plane)}
function containerName(g,z,flip=false){const cv=document.createElement('canvas');cv.width=1024;cv.height=128;const ctx=cv.getContext('2d');ctx.fillStyle='#f6edcf';ctx.font='bold 72px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('KIN KIN TRUKINDO',512,64);const texture=new T.CanvasTexture(cv);texture.colorSpace=T.SRGBColorSpace;const m=new T.Mesh(new T.PlaneGeometry(5.5,.69),new T.MeshStandardMaterial({map:texture,transparent:true,depthWrite:false,roughness:.8}));m.position.set(0,-.92,z);if(flip)m.rotation.y=Math.PI;g.add(m)}
function container(g,x,y,z,color='#1b3f60',branded=false){let c=new T.Group();c.position.set(x,y,z);g.add(c);box(c,0,0,0,8,3,3,color);for(let i=-3.8;i<4;i+=.36){box(c,i,0,1.52,.055,2.8,.055,color);box(c,i,0,-1.52,.055,2.8,.055,color)}box(c,0,1.48,0,8.05,.08,3.08,color);if(branded){branding(c,0,.3,1.58,2.15);branding(c,0,.3,-1.58,2.15,true);containerName(c,1.59);containerName(c,-1.59,true)}return c}
scene.background=new T.Color('#e8e7df');scene.fog=new T.Fog('#e8e7df',85,170);sun.position.set(-30,80,25);sun.shadow.camera.left=-80;sun.shadow.camera.right=80;sun.shadow.camera.top=80;sun.shadow.camera.bottom=-80;sun.shadow.camera.far=240;
box(scene,0,-.6,85,260,1,310,'#e0e3d3');box(scene,0,-.7,340,700,.3,200,'#7ca9ae');
const route=new T.CatmullRomCurve3([new T.Vector3(23,0,-10),new T.Vector3(24,0,8),new T.Vector3(23,0,42),new T.Vector3(7,0,70),new T.Vector3(-25,0,100),new T.Vector3(-25,0,135),new T.Vector3(-9,0,165),new T.Vector3(26,0,192),new T.Vector3(24,0,223),new T.Vector3(24,0,249)]);
// Connect the warehouse loading apron to the route's first point without a gap.
const entryVertices=[],entryIndices=[];
// Taper the broad loading apron into the road; match its width, height and material.
const drivewaySections=[{x:23,z:-24,w:7},{x:23,z:-20,w:7},{x:23,z:-16,w:5.8},{x:23,z:-10,w:4.4},{x:23.02,z:-9.8,w:4.4}];
for(let i=0;i<drivewaySections.length;i++){const {x,z,w}=drivewaySections[i];entryVertices.push(x-w,.031,z,x+w,.031,z);if(i<drivewaySections.length-1){const k=i*2;entryIndices.push(k,k+1,k+2,k+1,k+3,k+2);}}
const entryGeometry=new T.BufferGeometry();entryGeometry.setAttribute('position',new T.Float32BufferAttribute(entryVertices,3));entryGeometry.setIndex(entryIndices);entryGeometry.computeVertexNormals();const driveway=new T.Mesh(entryGeometry,new T.MeshStandardMaterial({color:'#7a8584',side:T.DoubleSide}));driveway.receiveShadow=true;scene.add(driveway);
// Flush dock approach connects the warehouse slab to the asphalt apron.
box(scene,23,.025,-23,14,.05,3,'#aeb6ae');
for(let side of [-1,1]){const vergePoints=drivewaySections.slice(1).map(p=>new T.Vector3(p.x+side*p.w,.06,p.z));const verge=new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(vergePoints),20,.055,6,false),mat('#e5dfc9'));scene.add(verge);}
const samples=500;let vertices=[],indices=[];for(let i=0;i<=samples;i++){let t=i/samples,pos=route.getPointAt(t),dir=route.getTangentAt(t),side=new T.Vector3(-dir.z,0,dir.x);for(let sign of [-1,1]){let v=pos.clone().addScaledVector(side,4.4*sign);vertices.push(v.x,.03,v.z)}if(i<samples){let k=i*2;indices.push(k,k+1,k+2,k+1,k+3,k+2)}}let geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(vertices,3));geo.setIndex(indices);geo.computeVertexNormals();let road=new T.Mesh(geo,new T.MeshStandardMaterial({color:'#7a8584',side:T.DoubleSide}));road.receiveShadow=true;scene.add(road);for(let i=0;i<110;i++){let t=i/110,pt=route.getPointAt(t),dr=route.getTangentAt(t);let stripe=box(scene,pt.x,.055,pt.z,.13,.02,1.3,'#f5efda');stripe.rotation.y=Math.atan2(dr.x,dr.z)}
function tree(x,z,scale=1){const g=group(x,0,z);cyl(g,0,1*scale,0,.14*scale,2*scale,'#8d8064');let m=new T.Mesh(new T.SphereGeometry(1.6*scale,16,12),mat('#71865c'));m.position.y=2.6*scale;m.castShadow=true;g.add(m)}
for(let i=0;i<150;i++){let z=-45+(i*19%280),x=-65+(i*37%130);let near=route.getPoints(150).some(p=>Math.hypot(p.x-x,p.z-z)<9);if(!near&&Math.abs(x)>12&&!(z<5&&x>0)&&!(x<0&&z<45)&&!(x>0&&z>48&&z<180)&&!(x<0&&z>178))tree(x,z,.7+(i%4)*.18)}
for(let i=0;i<22;i++){let x=i%2?-48:58,z=45+i*7;if(x>0&&z>85&&z<195)continue;let hill=new T.Mesh(new T.SphereGeometry(9+i%4*2,18,10),mat(i%2?'#b4bea0':'#a8b795'));hill.scale.set(1,.45,1.4);hill.position.set(x,-2,z);hill.receiveShadow=true;scene.add(hill)}
// Open warehouse interior, clear loading aisle, and forklift.
const wh=group(21,0,-39);box(wh,0,.1,0,42,.3,38,'#cbd0c6');box(wh,21,5,-1,.3,10,36,'#eeece1');box(wh,0,9,-19,42,18,.3,'#eeece1');
for(let x of [-9,3,15]){for(let z of [-11,-4,3]){for(let y of [1,4,7]){box(wh,x,y,z,4,.16,5,'#a39159');for(let k of [-1,1])box(wh,x+k,y+1,z,1.7,1.8,4.3,'#bda47b')}for(let xx of [-2,2])box(wh,x+xx,4.5,z,.15,9,5.3,'#1b3f60')}}
for(let x of [-20,20])for(let z of [-18,17])box(wh,x,5,z,.35,10,.35,'#1b3f60');for(let z of [-18,17])box(wh,0,10,z,41,.4,.4,'#1b3f60');branding(wh,-3,15,-18.75,4.8);
// Brand sign: render only after the site's Montserrat face has loaded.
async function warehouseSign(){await document.fonts.load('800 80px Montserrat');await document.fonts.load('600 42px Montserrat');const c=document.createElement('canvas');c.width=2048;c.height=400;const ctx=c.getContext('2d');ctx.textAlign='center';ctx.fillStyle='#1b3f60';ctx.font='800 124px Montserrat';ctx.fillText('KIN KIN TRUKINDO',1024,165);ctx.fillStyle='#a39159';ctx.font='600 66px Montserrat';ctx.fillText('FREIGHT & LOGISTICS',1024,290);const texture=new T.CanvasTexture(c);texture.colorSpace=T.SRGBColorSpace;const sign=new T.Mesh(new T.PlaneGeometry(24,4.7),new T.MeshStandardMaterial({map:texture,transparent:true,depthWrite:false}));sign.position.set(-3,11.4,-18.72);wh.add(sign);lastSceneKey=''}warehouseSign();
// Production line, inspection tables and marked receiving bays.
box(wh,-16,1.1,-2,2.5,.3,24,'#506474');for(let z=-12;z<10;z+=3){box(wh,-16,1.6,z,1.5,.8,1.4,'#bda47b');box(wh,-16,.5,z,.3,1,1,'#1b3f60')}
for(let x of [-8,2,12]){box(wh,x,1,13,5,.3,2.2,'#a39159');for(let xx of [-2,2])box(wh,x+xx,.5,13,.2,1,1.8,'#1b3f60');box(wh,x,1.7,13,1.5,1.1,1.3,'#bda47b')}
for(let x of [17,29]){box(scene,x,.04,-26,.12,.03,23,'#edda92');box(scene,x+4,.04,-26,.12,.03,23,'#edda92')}
const fork=group(24,0,-35);box(fork,0,.8,0,1.5,1.2,2,'#a39159');for(let x of [-.65,.65]){box(fork,x,2,0,.12,2.5,.12,'#1b3f60');box(fork,x,1.4,1.3,.1,2.8,.1,'#1b3f60');box(fork,x,.3,2,.12,.12,1.6,'#1b3f60')}box(fork,0,3.2,0,1.8,.2,1.6,'#1b3f60');box(fork,0,1,2,1.2,1.2,1.3,'#bda47b');
// Sculpted tractor: separated cabin, windscreen, grille, mirrors and alloy hubs.
function ellipsoid(g,x,y,z,rx,ry,rz,color){const m=new T.Mesh(new T.SphereGeometry(1,20,14),mat(color));m.position.set(x,y,z);m.scale.set(rx,ry,rz);m.castShadow=true;g.add(m);return m}
const glass=new T.MeshPhysicalMaterial({color:'#183c50',metalness:.35,roughness:.12,clearcoat:1});
const truck=group();box(truck,-.2,1,0,11.2,.35,2.6,'#253640');
box(truck,4.7,2.25,0,2.7,2.8,2.86,'#4a643c');
const cabRoof=box(truck,4.55,3.65,0,2.5,.36,2.8,'#627d4e');
const windshield=box(truck,6.065,2.95,0,.05,1.12,2.5,'#183c50');windshield.material=glass;windshield.rotation.z=.09;
box(truck,6.13,2.08,0,.08,.5,2.05,'#192d38');for(let yy=1.91;yy<2.3;yy+=.1)box(truck,6.19,yy,0,.025,.025,1.9,'#a7b7b9');
box(truck,6.17,1.35,0,.24,.4,2.95,'#d2d8d4');
for(const z of [-1.44,1.44]){
 const window=box(truck,4.85,2.97,z,1.6,.95,.035,'#183c50');window.material=glass;
 box(truck,4.25,2.23,z*1.02,.34,.065,.07,'#c8d0cb');box(truck,4.4,1.12,z*1.03,1.7,.14,.35,'#9aa8a6');
 box(truck,5.65,2.9,z*1.18,.12,.13,.55,'#233e4e');box(truck,5.65,2.8,z*1.38,.24,.55,.22,'#263e48');
 box(truck,6.18,1.57,z*.72,.04,.23,.48,'#fff1bf');box(truck,6.18,1.87,z*.85,.04,.1,.2,'#efa341');
}
for(let x of [-4,-2.65,4.7])for(let z of [-1.45,1.45]){
 let tire=cyl(truck,x,.78,z,.76,.48,'#202a30');tire.rotation.x=Math.PI/2;
 let rim=cyl(truck,x,.78,z*1.18,.47,.035,'#aab5b8');rim.rotation.x=Math.PI/2;
 let hub=cyl(truck,x,.78,z*1.2,.19,.06,'#62747b');hub.rotation.x=Math.PI/2;
 for(let a=0;a<8;a++){let hole=cyl(truck,x+Math.cos(a*Math.PI/4)*.31,.78+Math.sin(a*Math.PI/4)*.31,z*1.2,.065,.04,'#263c49');hole.rotation.x=Math.PI/2;}
}
box(truck,1.9,.95,0,1.1,.7,2.45,'#a6b1ad');
// Fine engineering details: chassis rails, axles, door seams and wheel arches.
for(let z of [-1.05,1.05])box(truck,-1,.95,z,8.7,.16,.13,'#6f7f85');
for(let x of [-4,-2.65,4.7]){let axle=cyl(truck,x,.78,0,.12,2.9,'#465861');axle.rotation.x=Math.PI/2;for(let side of [-1,1]){const arc=new T.Mesh(new T.TorusGeometry(.87,.09,8,32,Math.PI),mat('#536c47'));arc.position.set(x,.78,side*1.6);truck.add(arc);}}
for(let side of [-1,1]){
 const z=side*1.455;for(let x of [3.65,5.8])box(truck,x,2.2,z,.023,2,.02,'#30472f');box(truck,4.7,1.53,z,2.1,.024,.02,'#30472f');
 box(truck,4.45,1.12,side*1.55,1.7,.06,.3,'#abb6b5');
 for(let x=3.7;x<5.4;x+=.14)box(truck,x,1.16,side*1.57,.025,.025,.22,'#495f67');
 for(let x of [-4,-2.65,4.7])for(let n=0;n<24;n++){let angle=n*Math.PI/12;const tread=box(truck,x+Math.cos(angle)*.753,.78+Math.sin(angle)*.753,side*1.45,.055,.035,.44,'#303b40');tread.rotation.z=angle;}
}
for(let z of [-.75,.75]){const wiper=box(truck,6.105,2.5,z,.035,.025,.7,'#adb7b5');wiper.rotation.x=z>0?.18:-.18;}

const rollingWheels=truck.children.filter(o=>o.geometry?.type==='CylinderGeometry'&&o.geometry.parameters.radiusTop>=.45);
const cargo=container(scene,0,3,0,'#1b3f60',true);
// Port at the end of the route. The sea fills the entire horizon.
box(scene,25,.1,252,52,.5,26,'#c5cdc5');for(let x of [1,6])for(let z of [252,261]){let c=container(scene,x,1.9,z,'#4a643c');c.rotation.y=Math.PI/2}
// Smooth continuous hull loft: rounded stern, flared sides and a tapered bow.
const ship=group(35,0,281);
function hullBand(low,high,color){const verts=[],idx=[],stations=48;for(let i=0;i<=stations;i++){const x=-15+i*33/stations;const taper=x>10?Math.sqrt(Math.max(.005,1-((x-10)/8)**2)):x<-12?Math.sqrt(Math.max(.2,1-((x+12)/5)**2)):1;for(let j=0;j<4;j++){const y=j<2?low:high,side=j%2?-1:1;verts.push(x,y,side*taper*(y<0?3.55:4.05));}}for(let i=0;i<stations;i++){let k=i*4;for(const [a,b] of [[0,1],[0,2],[1,3],[2,3]])idx.push(k+a,k+b,k+4+a,k+b,k+4+b,k+4+a);}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(verts,3));g.setIndex(idx);g.computeVertexNormals();const mesh=new T.Mesh(g,new T.MeshStandardMaterial({color,roughness:.42,side:T.DoubleSide}));mesh.castShadow=true;mesh.receiveShadow=true;ship.add(mesh);}
hullBand(-1.15,-.55,'#a95643');hullBand(-.55,1.7,'#1b3f60');hullBand(1.7,1.82,'#ddd6bf');
box(ship,-11,3.5,0,4.8,3.4,6.3,'#f0eee4');box(ship,-10.8,5.5,0,5.5,.7,6.8,'#f4f1e8');for(let z of [-3.43,3.43]){box(ship,-10.8,5.5,z,4.8,.42,.03,'#376879');for(let x=-13;x<-8.5;x+=.7)box(ship,x,3.7,z*.92,.4,.45,.03,'#346476');}box(ship,-12,6.5,0,1.8,1.4,1.6,'#ba6c45');box(ship,-12,7.2,0,1.9,.2,1.7,'#263f51');cyl(ship,-9,7.3,0,.08,3,'#c9d1c8');
for(let side of [-1,1]){for(let x=-14;x<16;x+=1.2)cyl(ship,x,2.2,side*3.85,.035,.8,'#d5ded9');curveShape(ship,[[-14,2.6,side*3.85],[0,2.6,side*3.85],[10,2.6,side*3.85],[15,2.6,side*2.7]],.035,'#d5ded9');}
const cargoColors=['#bd573d','#34818b','#d3a54c','#456d59','#2c526f','#d08458'];for(let ix=0;ix<2;ix++)for(let iz=0;iz<2;iz++){const x=-3+ix*9,z=-1.7+iz*3.4;container(ship,x,3.32,z,cargoColors[ix*2+iz]);if(ix===1)container(ship,x,6.37,z,cargoColors[4+iz],iz===1);}
box(scene,-9,.1,251,18,.5,34,'#c5cdc5');box(scene,54,.1,244,23,.5,26,'#c5cdc5');
// Container yards stay beyond the truck lane and crane working envelope.
for(const [x,z,n] of [[-9,241,0],[-9,251,1],[-9,261,2],[49,238,3],[58,238,4],[58,248,5],[-5,-62,1],[5,-62,2],[15,-62,3],[-7,-48,4],[-7,-37,5]]){for(let level=0;level<(n%3===0?3:2);level++){const c=container(scene,x,1.7+level*3.06,z,cargoColors[(n+level)%6],level===0&&n%3===0);if(z>0)c.rotation.y=Math.PI/2;}}
const crane=group(24,0,261);for(let x of [-14,14])for(let z of [-7,-1])box(crane,x,9,z,.5,18,.5,'#a39159');for(let x of [-14,14])box(crane,x,18,4,.6,.7,41,'#a39159');for(let z of [-16,0,24])box(crane,0,18,z,29,.6,.5,'#a39159');const trolley=box(crane,0,17.5,-12,29,.4,1,'#1b3f60');const spread=group();box(spread,0,0,0,8.3,.25,3.3,'#a39159');const hoist=group();box(hoist,0,0,0,8.3,.3,3.3,'#1b3f60');const cables=[];for(let i=0;i<4;i++)cables.push(box(scene,0,0,0,.035,1,.035,'#36484b'));
// Working terminal: separated storage, staging and pedestrian zones.
box(scene,-25,.1,250,29,.5,40,'#c5cdc5');box(scene,65,.1,254,34,.5,44,'#c5cdc5');
for(let row=0;row<3;row++)for(let col=0;col<2;col++){const x=-31+col*10,z=237+row*11;for(let level=0;level<2+(row===1?1:0);level++)container(scene,x,1.85+level*3.06,z,cargoColors[(row*2+col+level)%6]);}
for(let row=0;row<3;row++){const x=73,z=239+row*11;for(let level=0;level<2;level++){const c=container(scene,x,1.85+level*3.06,z,cargoColors[(row+level+2)%6]);}}
// Yard markings guide cargo handling away from the main quay crane.
for(let z=235;z<272;z+=4){box(scene,44,.38,z,.13,.025,2,'#f2e3b1');box(scene,-1,.38,z,.13,.025,2,'#f2e3b1');}
for(let z of [236,246,256,266]){box(scene,51,.38,z,11,.025,.12,'#ece4c8');}
for(let z=238;z<264;z+=1)box(scene,36,.38,z,2,.025,.35,'#eee6ce');
for(let x of [-4,6,16,26,36,46,56]){cyl(scene,x,.65,265,.22,.55,'#374f5b');box(scene,x,.95,265,.7,.15,.25,'#374f5b');}
// Reach stacker parked in the side yard, with a container resting on its chassis.
const reach=group(43,0,239);box(reach,0,1,0,3,1.5,5,'#d5a34c');box(reach,-.7,2.4,-.7,1.4,1.9,1.8,'#e2bb65');box(reach,-.7,2.7,.23,1.15,.85,.04,'#386c7c');for(let x of [-1.55,1.55])for(let z of [-1.5,1.5]){const w=cyl(reach,x,.7,z,.7,.55,'#283a44');w.rotation.z=Math.PI/2;}limb(reach,[0,1.6,-1.6],[0,5.7,2.8],.28,'#af8039');box(reach,0,5.7,2.8,4,.25,.4,'#304957');
// Small terminal office, canopy and parked service vehicles.
const office=group(-14,0,225);box(office,0,1.8,0,11,3.6,5,'#eeead9');box(office,0,3.7,0,11.7,.25,5.7,'#2d566a');for(let x of [-3.5,0,3.5])box(office,x,2,2.54,2.2,1.4,.05,'#548590');box(office,0,.35,3.1,3,.35,1,'#afbaae');labelPlane(office,'TERMINAL OPERATIONS',3,2.6,8);
for(let x of [-25,65])for(let z of [237,263]){cyl(scene,x,6,z,.1,12,'#617c83');box(scene,x,12,z,3,.18,.5,'#d7dfd6');}
// Human-scale activity: loaders, warehouse operators, dockworkers and vessel crew.
function person(x,z,color='#a39159',parent=scene,y=0){
 const g=new T.Group();g.position.set(x,y,z);parent.add(g);
 const torso=ellipsoid(g,0,1.23,0,.32,.44,.21,color);
 box(g,0,1.17,.205,.52,.1,.025,'#eee6b8');for(let xx of [-.18,.18])box(g,xx,1.32,.19,.065,.5,.04,'#eee6b8');
 ellipsoid(g,0,1.82,0,.22,.27,.21,'#bb8f70');ellipsoid(g,0,2.02,0,.26,.15,.25,'#e5bb50');cyl(g,0,1.99,0,.3,.055,'#e5bb50');
 for(let xx of [-.085,.085])ellipsoid(g,xx,1.85,.197,.025,.025,.018,'#27353d');
 const legs=[];for(let xx of [-.16,.16]){let pivot=new T.Group();pivot.position.set(xx,.94,0);g.add(pivot);ellipsoid(pivot,0,-.33,0,.115,.38,.12,'#263f56');box(pivot,0,-.79,.07,.24,.16,.39,'#23313a');legs.push(pivot);}
 const arms=[];for(let sign of [-1,1]){let pivot=new T.Group();pivot.position.set(sign*.31,1.48,0);g.add(pivot);ellipsoid(pivot,sign*.035,-.26,0,.105,.29,.11,color);ellipsoid(pivot,sign*.035,-.55,.02,.09,.11,.09,'#bb8f70');arms.push(pivot);}
 return {g,legs,arms};
}
const loader1=person(28,-33),loader2=person(31,-28,'#4a643c'),sorter=person(7.5,-38,'#a39159');box(loader1.g,0,1.05,.45,.8,.65,.65,'#bda47b');box(loader2.g,0,1.05,.45,.65,.6,.6,'#bda47b');
for(let xx of [-.85,.85])for(let zz of [-.65,.65]){let wheel=cyl(fork,xx,.4,zz,.35,.2,'#263038');wheel.rotation.z=Math.PI/2}const forkSorting=fork.clone();scene.add(forkSorting);forkSorting.position.set(31,0,-34);forkSorting.scale.setScalar(.85);person(0,-.35,'#4a643c',forkSorting,.35);person(0,-.35,'#4a643c',fork,.35);
for(let i=0;i<4;i++){box(scene,3+i*2,.2,-55,1.6,.2,1.5,'#8e7654');box(scene,3+i*2,.85,-55,1.3,1.1,1.3,'#bda47b')}
loader1.carrying=true;loader2.carrying=true;
const dock1=person(32,253,'#a39159'),dock2=person(37,258,'#a39159'),signal=person(29,250,'#4a643c');const crew1=person(-6.5,-3.2,'#f4efe0',ship,1.8),crew2=person(12,2.6,'#f4efe0',ship,1.8);box(signal.g,.5,1.6,0,.12,.85,.12,'#a39159');
const staff=[person(9,-27),person(15,-23,'#4a643c'),person(25,-23),person(38,-27,'#4a643c'),person(8,-44),person(8,-34,'#4a643c')];
function walk(person,t){const stride=Math.sin(t)*.28;person.g.rotation.z=Math.sin(t*.5)*.025;person.legs[0].rotation.x=stride;person.legs[1].rotation.x=-stride;if(person.arms){person.arms[0].rotation.x=person.carrying?-1.05:-Math.sin(t+.3)*.19;person.arms[1].rotation.x=person.carrying?-1.05:Math.sin(t)*.24}}
// Roadside details remain outside the eight-metre carriageway.
const roadSamples=route.getPoints(350);
function clearRoad(x,z,r=4){return roadSamples.every(p=>Math.hypot(p.x-x,p.z-z)>r+5)}
function cottage(x,z,scale=1){if(!clearRoad(x,z,5*scale))return;const g=group(x,0,z);box(g,0,1.6*scale,0,5*scale,3.2*scale,4*scale,'#e8ddc1');const roof=new T.Mesh(new T.ConeGeometry(4*scale,2*scale,4),mat('#9b7960'));roof.rotation.y=Math.PI/4;roof.position.y=4*scale;roof.castShadow=true;g.add(roof);box(g,0,1,2.02*scale,1*scale,2,.06,'#4a643c');for(let xx of [-1.6,1.6])box(g,xx*scale,1.9,2.03*scale,.8,.9,.04,'#93acaf')}
// Compact city, quieter villages and terraced agricultural land.
// New York-inspired blocks: brick streets, stepped Art Deco towers and spires.
function windows(g,w,d,h,color='#c5dce0'){
 for(let side of [-1,1]){
 for(let axis=0;axis<2;axis++){
 const facade=new T.Group();facade.rotation.y=axis*Math.PI/2;g.add(facade);const width=axis?d:w,depth=axis?w:d;
 const curtain=box(facade,0,h/2,side*(depth/2+.02),width-.45,h-1.5,.04,'#294a5d');curtain.material=glass;
 for(let x=-width/2+.55;x<width/2;x+=.85)box(facade,x,h/2,side*(depth/2+.07),.045,h-1.4,.07,'#a3b2ae');
 for(let y=1.5;y<h-.5;y+=1.25)box(facade,0,y,side*(depth/2+.07),width-.4,.045,.065,'#7f9fa7');
 for(let y=2;y<h-1;y+=2.5)for(let x=-width/2+.8;x<width/2-.5;x+=1.7){if(Math.round(y+x)%3===0)box(facade,x,y,side*(depth/2+.08),.5,.75,.03,color);}
 }
 }
 box(g,0,.15,0,w+1.2,.3,d+1.2,'#c3c7bf');
 box(g,0,.85,d/2+.08,1.4,1.5,.06,'#507b87');box(g,0,1.8,d/2+.55,2,.09,1.2,'#b7c9c9');
 for(let x of [-w/2+.15,w/2-.15])for(let z of [-d/2+.15,d/2-.15])box(g,x,h/2,z,.12,h,.12,'#859da5');
 box(g,0,h+.4,0,w*.4,.75,d*.35,'#9caaa9');for(let x=-w*.15;x<w*.15;x+=.2)box(g,x,h+.79,0,.04,.025,d*.3,'#4b636e');
 for(let side of [-1,1]){box(g,0,h+.25,side*d/2,w,.5,.1,'#8a9d9f');box(g,side*w/2,h+.25,0,.1,.5,d,'#8a9d9f');}

}
for(let i=0;i<15;i++){const x=-35+(i%3)*10,z=4+Math.floor(i/3)*9;if(!clearRoad(x,z,5))continue;const h=7+(i*7%17),g=group(x,0,z);box(g,0,h/2,0,6,h,6,['#9d4f37','#385c78','#86735b','#455b65'][i%4]);windows(g,6,6,h,i%2?'#f3ce76':'#91c8d8');box(g,0,h+.2,0,6.4,.4,6.4,'#263e53');if(i%4===0){box(g,0,h+2,0,4,4,4,'#b6ab91');box(g,0,h+5,0,2.4,3,2.4,'#b6ab91');cyl(g,0,h+8,0,.13,5,'#c9b68d')}if(i%3===1){box(g,0,2,3.2,6,.5,.6,'#d34c32');cyl(g,1,h+1.7,0,1,2.6,'#70503a')}}
// Shanghai-inspired waterfront: glass towers, a twisting skyscraper and pearl observation tower.
for(let i=0;i<8;i++){let x=17+(i%3)*11,z=90+Math.floor(i/3)*12;if(!clearRoad(x,z,6))continue;const h=12+(i*5%18),g=group(x,0,z);box(g,0,h/2,0,6,h,6,i%2?'#237b96':'#265b8b');windows(g,6,6,h,'#8cd2dc');for(let y=4;y<h;y+=5)box(g,0,y,0,6.2,.16,6.2,'#d6e4d8')}
const twist=group(39,0,126);const towerGeo=new T.CylinderGeometry(2.2,4,27,36,32);const towerPos=towerGeo.attributes.position;for(let i=0;i<towerPos.count;i++){const v=new T.Vector3().fromBufferAttribute(towerPos,i);v.applyAxisAngle(new T.Vector3(0,1,0),(v.y+13.5)*.022);towerPos.setXYZ(i,v.x,v.y,v.z);}towerGeo.computeVertexNormals();const tower=new T.Mesh(towerGeo,new T.MeshPhysicalMaterial({color:'#3f8799',metalness:.45,roughness:.22,clearcoat:.7}));tower.position.y=13.5;tower.castShadow=true;twist.add(tower);for(let y=1;y<27;y+=.9){const ring=new T.Mesh(new T.TorusGeometry(4-(y/27)*1.8+.03,.025,6,48),mat('#8bafb8'));ring.rotation.x=Math.PI/2;ring.position.y=y;twist.add(ring);}cyl(twist,0,28,0,.1,3,'#d8d6be');
const pearl=group(13,0,124);cyl(pearl,0,10,0,.65,20,'#adb9b9');for(let yy of [8,19]){const globe=new T.Mesh(new T.SphereGeometry(yy===8?3:2.1,18,12),mat('#c45165'));globe.position.y=yy;globe.castShadow=true;pearl.add(globe);cyl(pearl,0,yy,0,yy===8?3.1:2.2,.3,'#e3cc95')}cyl(pearl,0,24,0,.16,7,'#c4cecc');
for(const [x,z] of [[27,80],[18,141],[-32,180],[-39,192],[-30,206]])cottage(x,z,.8);
for(let row=0;row<4;row++)for(let col=0;col<3;col++){const x=22+col*7,z=173+row*6;if(row>1||!clearRoad(x,z,5))continue;box(scene,x,.05,z,7.5,.15,5.4,'#a7b47c');box(scene,x,.15,z,7,.07,4.9,'#849d69');for(let k=-2;k<=2;k++)box(scene,x,.22,z+k*.8,6.6,.16,.09,'#b9c783')}
const lake=new T.Mesh(new T.CircleGeometry(12,48),mat('#87b5b6'));lake.rotation.x=-Math.PI/2;lake.scale.set(1,.6,1);lake.position.set(28,.02,65);lake.receiveShadow=true;scene.add(lake);for(let n=0;n<5;n++)box(scene,22+n*2,.06,64+n%2,1,.02,.08,'#c3d8d1');
box(scene,-42,-.02,220,32,.12,30,'#d9c99f');box(scene,-62,-.12,220,22,.12,30,'#8ab6bb');for(let z of [210,220,230]){const g=group(-38,0,z);cyl(g,0,2.5,0,.18,5,'#9f8e6e');for(let a=0;a<6;a++){const leaf=box(g,Math.cos(a)*1.3,5,Math.sin(a)*1.3,3,.12,.7,'#647c50');leaf.rotation.y=-a;leaf.rotation.z=.18}}
// Two-lane toll canopy: posts and staffed booths sit off the driving lane.
const tollPoint=route.getPointAt(.19),tollDirection=route.getTangentAt(.19),toll=group(tollPoint.x,0,tollPoint.z);toll.rotation.y=Math.atan2(tollDirection.x,tollDirection.z);for(let x of [-5.4,5.4]){box(toll,x,3,0,.4,6,.4,'#a39159');box(toll,x,1.3,2,1.5,2.6,2,'#d4d6c5');box(toll,x,1.8,3.03,1,.7,.03,'#76939b')}box(toll,0,6.3,0,12,.5,4,'#1b3f60');for(let x of [-2,2])box(toll,x,5.9,2.05,.5,.3,.05,'#76a65c');const tollSign=document.createElement('canvas');tollSign.width=512;tollSign.height=96;const tc=tollSign.getContext('2d');tc.fillStyle='#f7f4ee';tc.font='bold 44px Arial';tc.textAlign='center';tc.fillText('TOL  /  TOLL',256,65);const tt=new T.CanvasTexture(tollSign);tt.colorSpace=T.SRGBColorSpace;const tm=new T.Mesh(new T.PlaneGeometry(6,1),new T.MeshStandardMaterial({map:tt,transparent:true}));tm.position.set(0,6.7,2.1);toll.add(tm);
for(let x of [-7.5,7.5]){const officer=person(x,3,'#657c88',toll);box(officer.g,0,1.2,.2,.55,.17,.03,'#e3d8a0')}
function smallCar(color){const g=group();box(g,0,.65,0,1.5,.65,3.1,color);box(g,0,1.18,-.15,1.3,.6,1.7,'#aebdc1');box(g,0,1.5,-.15,1.35,.12,1.8,color);for(let xx of [-.78,.78])for(let zz of [-1,1]){const w=cyl(g,xx,.4,zz,.33,.18,'#35434a');w.rotation.z=Math.PI/2}return g}
const carColors=['#e73532','#f4ba24','#176bb7','#15975f','#ed7826','#813fa3','#19a9b9','#c92364'];
function specialtyVehicle(type,color){if(type==='motorcycle'){const g=group();for(let z of [-.65,.65]){const wheel=cyl(g,0,.4,z,.4,.18,'#25333e');wheel.rotation.z=Math.PI/2}box(g,0,.75,0,.35,.35,1.3,color);box(g,0,1.1,-.15,.3,.45,.4,'#26394a');cyl(g,0,1.5,-.1,.19,.28,'#e1bc8d');box(g,0,1.2,.5,.85,.08,.1,'#70858b');return g}const g=smallCar(color);if(type==='sport'){g.clear();box(g,0,.42,0,1.85,.42,3.7,'#dc171f');box(g,0,.72,-.2,1.4,.42,1.65,'#142a39');box(g,0,.95,-.25,1.5,.12,1.25,'#e51c24');box(g,0,.5,1.5,1.85,.14,.85,'#eb2228');box(g,0,.45,-1.9,1.9,.14,.25,'#172c37');for(let xx of [-.95,.95])for(let zz of [-1.2,1.2]){const w=cyl(g,xx,.33,zz,.36,.22,'#162735');w.rotation.z=Math.PI/2;const hub=cyl(g,xx*1.13,.33,zz,.22,.025,'#b8c5c8');hub.rotation.z=Math.PI/2}for(let xx of [-.6,.6])box(g,xx,.58,1.91,.45,.08,.04,'#fff4bd');box(g,0,.56,1.1,.14,.025,.6,'#f4c345')}if(type==='monster'){g.position.y=.3;g.scale.set(1,1.2,1.1);for(let x of [-1,1])for(let z of [-1,1]){const wheel=cyl(g,x,.55,z,.65,.45,'#27353d');wheel.rotation.z=Math.PI/2}}if(type==='police'){box(g,0,.8,0,1.52,.4,1.4,'#f1eee5');box(g,0,1.67,0,1,.12,.3,'#25333e');box(g,-.28,1.78,0,.35,.15,.25,'#e13b36');box(g,.28,1.78,0,.35,.15,.25,'#2678cb')}g.userData.type=type;return g}
const trafficTypes=['sport','car','motorcycle','police','car','monster','sport','motorcycle','car','police','car','sport'];const otherTraffic=trafficTypes.map((type,i)=>specialtyVehicle(type,carColors[i%carColors.length]));
const portVan=smallCar('#e4b142');portVan.position.set(-19,.35,227);portVan.rotation.y=Math.PI/2;
const portPickup=smallCar('#3f8c91');portPickup.position.set(40,.35,239);
const terminalCrew=[person(39,248,'#d4a546'),person(41,254,'#ce794b'),person(-4,240,'#4e8990'),person(-6,229,'#d4a546')];
const cargoFork=fork.clone();scene.add(cargoFork);cargoFork.position.set(-3,.35,247);cargoFork.rotation.y=Math.PI;
const staging=group(38,0,260);for(let i=0;i<3;i++){box(staging,i*1.6,.6,0,1.35,.5,1.35,'#ad8c61');box(staging,i*1.6,1.2,0,1.1,.7,1.1,'#d5bb83');}
// Suspension bridge: masonry towers flank the road, with cables anchored to the deck.
const bridgePoint=route.getPointAt(.37),bridgeDir=route.getTangentAt(.37),bridge=group(bridgePoint.x,0,bridgePoint.z);bridge.rotation.y=Math.atan2(bridgeDir.x,bridgeDir.z);box(bridge,0,-.02,0,10,.25,28,'#929b94');for(let x of [-5.1,5.1]){box(bridge,x,.6,0,.18,1.2,28,'#6e7977');for(let z of [-9,9]){box(bridge,x,6,z,1.2,12,1.8,'#b2a086');box(bridge,x,12.1,z,1.5,.4,2.1,'#cbb99a')}if(x<0)for(let z of [-9,9])box(bridge,0,10.6,z,10.2,1,1.8,'#b2a086');for(let z=-14;z<14;z+=.65){const y=Math.abs(z)<=9?4+7*Math.pow(Math.abs(z)/9,2):11-(Math.abs(z)-9)*1.8;const yn=Math.abs(z+.65)<=9?4+7*Math.pow(Math.abs(z+.65)/9,2):11-(Math.abs(z+.65)-9)*1.8;const start=new T.Vector3(x,y,z),end=new T.Vector3(x,yn,z+.65);const path=new T.LineCurve3(start,end);const cable=new T.Mesh(new T.TubeGeometry(path,1,.07,5,false),mat('#56676a'));bridge.add(cable);box(bridge,x,(y+.8)/2,z,.035,y-.8,.035,'#66787a')}}
// Chongqing-inspired elevated metro runs beside the glass city on its own viaduct.
const viaduct=group(50,0,109);box(viaduct,0,8,0,4,.65,62,'#9aa9a5');for(let z=-28;z<=28;z+=8)box(viaduct,0,4,z,.8,8,1.4,'#bcc4b9');for(let x of [-1.8,1.8]){box(viaduct,x,8.7,0,.15,.8,62,'#788c8e');box(viaduct,x*.55,8.4,0,.1,.12,62,'#4b6067')}
const metro=group(50,8.8,90);for(let z of [-6,0,6]){box(metro,0,1,z,2.7,2,5.6,'#e5e8df');box(metro,0,.65,z,2.76,.45,5.6,'#d84e36');box(metro,0,2.1,z,2.7,.2,5.6,'#415f72');for(let xx of [-1.37,1.37])for(let dz of [-1.7,0,1.7])box(metro,xx,1.45,z+dz,.025,.7,1.25,'#2d687d')}box(metro,0,1.45,8.83,2.1,.8,.03,'#2d687d');
// Irrigation river, farmers, cattle and sheep beside the rice terraces.
const riverCurve=new T.CatmullRomCurve3([new T.Vector3(46,.12,136),new T.Vector3(43,.12,149),new T.Vector3(46,.12,161),new T.Vector3(43,.12,176),new T.Vector3(48,.12,190)]);const rv=[],ri=[];for(let i=0;i<=100;i++){const p=riverCurve.getPoint(i/100),d=riverCurve.getTangent(i/100),n=new T.Vector3(-d.z,0,d.x);for(let side of [-1,1]){let v=p.clone().addScaledVector(n,side*2);rv.push(v.x,v.y,v.z)}if(i<100){let k=i*2;ri.push(k,k+1,k+2,k+1,k+3,k+2)}}const rg=new T.BufferGeometry();rg.setAttribute('position',new T.Float32BufferAttribute(rv,3));rg.setIndex(ri);rg.computeVertexNormals();scene.add(new T.Mesh(rg,new T.MeshStandardMaterial({color:'#258fa1',side:T.DoubleSide})));
// A small farm with a clear yard, two paddocks and work areas.
// Farm landscaping follows an irregular contour and excludes the road corridor.
const meadowPositions=[],meadowColors=[];const meadowTint=new T.Color('#b9c69c'),groundTint=new T.Color('#e0e3d3');
function meadowVertex(x,z){const edge=Math.sqrt(((x-21)/22)**2+((z-159)/29)**2);const roadDistance=Math.min(...roadSamples.map(p=>Math.hypot(p.x-x,p.z-z)));const blend=Math.max(0,Math.min(1,(1-edge)*5,(roadDistance-5.8)/3));const color=groundTint.clone().lerp(meadowTint,blend);meadowPositions.push(x,-.085,z);meadowColors.push(color.r,color.g,color.b);}
for(let x=-2;x<44;x+=1)for(let z=129;z<189;z+=1){const points=[[x,z],[x+1,z],[x,z+1],[x+1,z],[x+1,z+1],[x,z+1]];if(points.some(([px,pz])=>roadSamples.some(p=>Math.hypot(p.x-px,p.z-pz)<5.8)))continue;points.forEach(([px,pz])=>meadowVertex(px,pz));}
const meadowGeometry=new T.BufferGeometry();meadowGeometry.setAttribute('position',new T.Float32BufferAttribute(meadowPositions,3));meadowGeometry.setAttribute('color',new T.Float32BufferAttribute(meadowColors,3));meadowGeometry.computeVertexNormals();const meadow=new T.Mesh(meadowGeometry,new T.MeshStandardMaterial({vertexColors:true,roughness:1,side:T.DoubleSide}));meadow.receiveShadow=true;scene.add(meadow);
for(const [x,z,r] of [[19,138,1],[24,136,1.2],[30,138,1.1],[34,141,.9]])tree(x,z,r);
const barn=group(25,0,151);
box(barn,0,.12,0,15,.25,13,'#c5bd96');box(barn,0,2.6,0,12,5.2,9,'#b96545');
for(let x=-5.7;x<6;x+=.6)for(let side of [-1,1])box(barn,x,2.6,side*4.53,.065,5.1,.04,'#d48b64');
for(let side of [-1,1]){box(barn,side*5.9,2.6,0,.18,5.3,9.2,'#f1dfb5');const roof=box(barn,side*3.15,6.35,0,7.2,.35,10.5,'#3c6467');roof.rotation.z=-side*.36;}
// Closed gable triangles and framed double doors.
for(let side of [-1,1]){const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([-6,5.2,side*4.52,6,5.2,side*4.52,0,7.45,side*4.52],3));g.computeVertexNormals();barn.add(new T.Mesh(g,new T.MeshStandardMaterial({color:'#b96545',side:T.DoubleSide})));}
box(barn,0,2.05,4.59,4,4.1,.15,'#734a37');for(let x of [-2.1,0,2.1])box(barn,x,2.1,4.72,.13,4.3,.1,'#f1dfb5');box(barn,0,4.2,4.72,4.4,.15,.1,'#f1dfb5');for(let side of [-1,1]){limb(barn,[side*2,0.2,4.78],[0,3.95,4.78],.07,'#f1dfb5');box(barn,side*4,3.2,4.6,1.4,1.5,.15,'#f0dfb6');box(barn,side*4,3.2,4.7,1.1,1.2,.06,'#3e6571');box(barn,side*4,3.2,4.75,.06,1.2,.04,'#f0dfb6');}
box(barn,0,5.9,4.6,1.1,.8,.08,'#f0dfb6');box(barn,0,5.9,4.68,.8,.5,.05,'#3e6571');
// Hay rolls and a water barrel beside the barn, outside walking paths.
for(const [x,z] of [[-5,6],[-3.5,6],[-5,7.5]]){const hay=cyl(barn,x,.65,z,.65,1.3,'#d5b661');hay.rotation.z=Math.PI/2;for(let side of [-1,1]){const band=new T.Mesh(new T.TorusGeometry(.66,.035,6,24),mat('#9a854a'));band.rotation.y=Math.PI/2;band.position.set(x+side*.35,.65,z);barn.add(band);}}
cyl(barn,6.7,.65,2,.6,1.3,'#639a9a');cyl(barn,6.7,1.31,2,.53,.025,'#91c6cb');
function fenceLine(x1,z1,x2,z2){const length=Math.hypot(x2-x1,z2-z1),n=Math.ceil(length/2.5);for(let i=0;i<=n;i++){const t=i/n;box(scene,x1+(x2-x1)*t,.65,z1+(z2-z1)*t,.16,1.3,.16,'#d9c391');}for(let y of [.45,1])limb(scene,[x1,y,z1],[x2,y,z2],.07,'#d9c391');}
for(const rect of [[2,143,15,154],[2,158,15,169]]){const [x1,z1,x2,z2]=rect;fenceLine(x1,z1,x2,z1);fenceLine(x1,z2,x2,z2);fenceLine(x1,z1,x1,z2);fenceLine(x2,z1,x2,(z1+z2)/2-1);fenceLine(x2,(z1+z2)/2+1,x2,z2);}
// Three distinct jobs: carrying feed, tending crops and checking water.
const farmers=[];for(const [x,z,color,angle] of [[17,160,'#c0874c',-1.4],[35,174,'#577c89',.5],[32.8,155.8,'#b46f53',-1]]){const f=person(x,z,color);f.g.rotation.y=angle;const hat=new T.Mesh(new T.ConeGeometry(.43,.18,24),mat('#d8bc78'));hat.position.y=2.2;f.g.add(hat);cyl(f.g,0,2.1,0,.44,.045,'#d8bc78');farmers.push(f);}
farmers[0].carrying=true;box(farmers[0].g,0,1.05,.38,.65,.55,.5,'#b5a16a');farmers[0].arms.forEach(a=>a.rotation.x=-1.05);
limb(farmers[1].g,[.43,.12,.7],[.43,1.65,.15],.035,'#87633e');box(farmers[1].g,.43,.1,.72,.55,.08,.22,'#65818a');
function animal(x,z,sheep){const g=group(x,0,z),coat=sheep?'#e7dfcb':'#82513c';ellipsoid(g,0,1.15,0,sheep?.63:.7,.58,sheep?.9:1.15,coat);
if(sheep){for(let i=0;i<9;i++){const a=i*2.399;ellipsoid(g,Math.cos(a)*.28,1.12+Math.sin(i)*.12,Math.sin(a)*.55,.4,.45,.48,i%3?'#eee5d0':'#e7dcc5');}}
else{ellipsoid(g,-.56,1.25,-.3,.17,.4,.48,'#ede3cc');ellipsoid(g,.57,1.3,.35,.15,.34,.42,'#eee5d3');}
const head=new T.Group();head.position.set(0,1.35,.85);head.rotation.x=.45;g.add(head);ellipsoid(head,0,0,.25,.29,.36,.4,sheep?'#716250':coat);ellipsoid(head,0,-.17,.51,.28,.18,.2,sheep?'#5b5147':'#c59785');for(let sign of [-1,1]){const ear=ellipsoid(head,sign*.35,.1,.15,.25,.09,.12,coat);ear.rotation.z=sign*.3;ellipsoid(head,sign*.235,.06,.4,.035,.045,.025,'#20282b');if(!sheep)curveShape(head,[[sign*.2,.25,.1],[sign*.3,.46,.08],[sign*.42,.53,.15]],.055,'#c9bea1');}
for(let xx of [-.4,.4])for(let zz of [-.65,.65]){const shift=Math.sin(x+zz*9)*.08;limb(g,[xx,.95,zz],[xx+shift,.45,zz+.06],.09,coat);limb(g,[xx+shift,.45,zz+.06],[xx,.13,zz+.1],.065,coat);ellipsoid(g,xx,.1,zz+.13,.11,.1,.16,'#433a32');}curveShape(g,[[0,1.45,-.85],[.12,1.15,-1.18],[.18,.75,-1.2]],.045,coat);g.userData.head=head;return g;}
for(const z of [148.5,163.5]){const pasture=box(scene,8.5,.06,z,13.5,.1,11.5,'#9eb279');pasture.receiveShadow=true;}
// An uncluttered path connects the barn to the gates.
box(scene,18.5,.08,156,4,.08,22,'#d5c49b');box(scene,22,.08,159,11,.08,3,'#d5c49b');
for(let i=0;i<38;i++){const x=3+(i*2.173%11),z=i%2?159+(i*1.731%9):144+(i*1.731%9);for(let k=0;k<2;k++){const blade=new T.Mesh(new T.ConeGeometry(.05,.25,5),mat('#6f9259'));blade.position.set(x+k*.12,.23,z);blade.rotation.z=(k-.5)*.4;scene.add(blade);}}
const livestock=[];const grazingSpots=[[5.3,147,.65],[11.2,150,-1.2],[6.2,162,-.5],[10.7,165,1.7],[11.6,161,-1.9]];
grazingSpots.forEach(([x,z,angle],i)=>{const a=animal(x,z,i>=2);a.rotation.y=angle;a.scale.setScalar([1,.86,.86,.72,.95][i]);a.userData.restAngle=angle;livestock.push(a)});
// Grounded troughs and feed placed by the gates.
for(const z of [148.5,163.5]){box(scene,13.8,.35,z,.8,.7,2.2,'#8eaa9d');box(scene,13.8,.72,z,.64,.035,1.95,'#78b6bd');}

// Local landmarks, modeled as small stylized sculptures from the supplied references.
function tapered(g,x,y,z,rt,rb,h,color){const m=new T.Mesh(new T.CylinderGeometry(rt,rb,h,24),mat(color));m.position.set(x,y,z);m.castShadow=true;g.add(m);return m}
function limb(g,a,b,r,color){const v1=new T.Vector3(...a),v2=new T.Vector3(...b),d=v2.clone().sub(v1);const m=new T.Mesh(new T.CylinderGeometry(r,r,d.length(),10),mat(color));m.position.copy(v1).add(v2).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());m.castShadow=true;g.add(m)}
function curveShape(g,points,r,color){const path=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)));const m=new T.Mesh(new T.TubeGeometry(path,40,r,10,false),mat(color));m.castShadow=true;g.add(m);return m}
function labelPlane(g,text,y,z,w){const c=document.createElement('canvas');c.width=1024;c.height=128;const x=c.getContext('2d');x.fillStyle='#1b3f60';x.font='bold 58px Arial';x.textAlign='center';x.fillText(text,512,82);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;const m=new T.Mesh(new T.PlaneGeometry(w,w/8),new T.MeshStandardMaterial({map:t,transparent:true}));m.position.set(0,y,z);g.add(m)}
const monument=group(45,0,250);tapered(monument,0,.4,0,4.7,5.1,.8,'#e7dfc7');tapered(monument,0,3.7,0,3.9,4.4,6,'#e8e4d3');for(let a=0;a<12;a++){let angle=a*Math.PI/6;let window=box(monument,Math.sin(angle)*4.1,3.6,Math.cos(angle)*4.1,.55,3,.12,'#3a656c');window.rotation.y=angle}tapered(monument,0,7,0,4.7,4.1,.8,'#f1ead7');tapered(monument,0,8,0,2.8,3.5,1.2,'#e6dfc8');
const bronze='#6fa69b';limb(monument,[-.65,8.6,0],[-.55,11.3,0],.38,bronze);limb(monument,[.65,8.6,.3],[.45,11.3,0],.38,bronze);tapered(monument,0,12.2,0,.8,1,2.2,bronze);cyl(monument,0,14,0,.47,1,bronze);tapered(monument,0,14.65,0,.75,.65,.25,bronze);limb(monument,[-.8,13,0],[-1.1,11.7,.4],.25,bronze);limb(monument,[.8,13,0],[.75,11.5,.7],.25,bronze);limb(monument,[-1.1,11.7,.4],[-.7,11,.9],.22,bronze);limb(monument,[-.7,11,.9],[-1,8.5,1],.07,'#526f70');labelPlane(monument,'JALESVEVA JAYAMAHE',7.8,3.6,7);
const surabaya=group(39,0,-19);tapered(surabaya,0,.35,0,1.9,2.2,.7,'#afac94');const pale='#bcc5b6';curveShape(surabaya,[[-.8,.8,0],[-1,1.6,.2],[.2,2.2,.3],[.8,3.2,0],[.35,4,.1]],.3,pale);const crocHead=box(surabaya,.2,4.1,.3,.55,.4,1.25,pale);crocHead.rotation.z=-.3;for(let i=0;i<7;i++)box(surabaya,-.8+i*.19,1.6+i*.23,.4,.18,.2,.2,'#8c9b8b');curveShape(surabaya,[[.9,1,-.25],[.7,2,-.4],[-.5,2.9,-.2],[-.3,4,.1],[.5,4.8,.3]],.22,'#e5e8d9');const shark=new T.Mesh(new T.SphereGeometry(.45,14,10),mat('#e5e8d9'));shark.scale.set(.65,.65,2);shark.position.set(.5,4.8,.65);shark.rotation.z=.4;surabaya.add(shark);const fin=new T.Mesh(new T.ConeGeometry(.35,.7,3),mat('#d4dccb'));fin.position.set(.5,5.25,.55);surabaya.add(fin);for(let x of [-.7,.7])limb(surabaya,[.5,4.8,.5],[.5+x,4.65,.1],.08,'#d4dccb');labelPlane(surabaya,'SURA & BAYA',.5,2.05,3.5);
// Subtle drafting contours clarify construction without turning the scene into blocks.
const ink=new T.LineBasicMaterial({color:'#183b50',transparent:true,opacity:.22});
const outlined=[];scene.traverse(o=>{if(!o.isMesh||!o.geometry)return;const type=o.geometry.type;const size=o.geometry.parameters;if(type==='RoundedBoxGeometry' || (type==='BoxGeometry'&&size&&size.width>3&&size.height>2&&size.depth>2))outlined.push(o);});
for(const o of outlined){const edges=new T.LineSegments(new T.EdgesGeometry(o.geometry,35),ink);o.add(edges);}
const clamp=x=>Math.max(0,Math.min(1,x)),ease=x=>x*x*x*(x*(x*6-15)+10);const layout=document.querySelector('main');function resize(){renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);camera.aspect=canvas.clientWidth/canvas.clientHeight;camera.updateProjectionMatrix()}addEventListener('resize',resize);resize();
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');let smoothScroll=scrollY,previousTime=performance.now();function frame(){requestAnimationFrame(frame);const now=performance.now(),dt=Math.min(.05,(now-previousTime)/1000);previousTime=now;smoothScroll=reduceMotion.matches?scrollY:smoothScroll+(scrollY-smoothScroll)*(1-Math.exp(-12*dt));if(Math.abs(scrollY-smoothScroll)<.05)smoothScroll=scrollY;if(document.hidden)return;const sceneKey=[smoothScroll.toFixed(2),innerWidth,innerHeight].join(':');if(lastSceneKey===sceneKey)return;lastSceneKey=sceneKey;const offset=innerWidth<700?80:96;const raw=clamp((offset-layout.getBoundingClientRect().top+smoothScroll-scrollY)/(layout.offsetHeight-innerHeight+offset));const p=raw<.22?raw/.22*.055:raw<.66?.055+(raw-.22)/.44*.79:.845+(raw-.66)/.34*.155;let drive=clamp((p-.055)/.79),pos=route.getPointAt(drive),dir=route.getTangentAt(drive);otherTraffic.forEach((car,i)=>{const t=((.025+i/12-drive*.18)%1+1)%1,cp=route.getPointAt(t),cd=route.getTangentAt(t);car.position.copy(cp).add(new T.Vector3(-cd.z,0,cd.x).multiplyScalar(car.userData.type==='monster'?3.1:2.8));car.rotation.y=Math.atan2(-cd.x,-cd.z)});metro.position.z=90+drive*36;rollingWheels.forEach(w=>w.rotation.y=-drive*route.getLength()/.76);truck.position.copy(pos);truck.rotation.y=Math.atan2(-dir.z,dir.x);let local=new T.Vector3(-1,3,0).applyAxisAngle(new T.Vector3(0,1,0),truck.rotation.y).add(pos);cargo.position.copy(local);cargo.rotation.y=truck.rotation.y;
const loading=clamp(raw/.22);const loadCycle=loading*4*Math.PI;fork.position.set(18,0,-40+Math.sin(loadCycle)*6);fork.rotation.y=0;forkSorting.position.set(30,0,-40+Math.sin(loadCycle+Math.PI)*6);forkSorting.rotation.y=0;
loader1.g.position.set(22+Math.sin(loadCycle*.5)*1.5,0,-23);loader2.g.position.set(34+Math.sin(loadCycle*.5),0,-23);sorter.g.position.z=-38+Math.sin(loadCycle)*1.2;[loader1,loader2,sorter].forEach((w,i)=>walk(w,loadCycle*3+i));
const farmPhase=raw*28;
farmers[0].g.position.z=160+Math.sin(farmPhase*.45)*.65;walk(farmers[0],farmPhase*1.2);
farmers[1].g.rotation.x=.13+Math.sin(farmPhase*.7)*.09;farmers[1].arms[1].rotation.x=-.55+Math.sin(farmPhase*.7)*.18;
farmers[2].arms[0].rotation.x=-.4+Math.sin(farmPhase*.4)*.12;
livestock.forEach((g,i)=>{g.rotation.y=g.userData.restAngle+Math.sin(farmPhase*.18+i*1.7)*.055;if(g.userData.head){g.userData.head.rotation.x=.4+Math.sin(farmPhase*.5+i*1.4)*.3;g.userData.head.rotation.y=Math.sin(farmPhase*.25+i)*.09;}});
staff.forEach((w,i)=>{w.g.rotation.y=Math.sin(loadCycle+i)*.2;walk(w,loadCycle+i)});const portActivity=clamp((raw-.66)/.34)*Math.PI*6;cargoFork.position.z=247+Math.sin(portActivity*.5)*2;terminalCrew.forEach((w,i)=>{w.arms[0].rotation.x=-.4+Math.sin(portActivity*.4+i)*.15;});dock1.g.position.z=253+Math.sin(portActivity)*1.4;dock2.g.position.x=37+Math.sin(portActivity*.5)*2;walk(dock1,portActivity*3);walk(dock2,portActivity*3);crew1.g.position.z=-2+Math.sin(portActivity*.5)*.5;crew2.g.position.x=12+Math.sin(portActivity*.5)*.7;walk(crew1,portActivity*2);walk(crew2,portActivity*2);
let lift=ease(clamp((p-.85)/.035)),transfer=ease(clamp((p-.885)/.05)),lower=ease(clamp((p-.935)/.035)),sail=ease(clamp((p-.975)/.025));if(p>.85){cargo.position.y=3+lift*10-lower*6.63;cargo.position.x=local.x+(32-local.x)*transfer;cargo.position.z=local.z+(279.3-local.z)*transfer;cargo.rotation.y=truck.rotation.y*(1-transfer)}ship.position.x=35+sail*20;if(p>=.97){cargo.position.set(32+sail*20,6.37,279.3);cargo.rotation.y=0}// Permanently connected hoist. It descends, lifts, traverses, lowers and retracts.
const attach=ease(clamp((p-.845)/.005)),retract=ease(clamp((p-.97)/.005));spread.visible=p>=.84&&p<=.985;spread.position.copy(cargo.position);spread.position.y= p<.85?16-(16-4.7)*attach:p>=.97?8.07+retract*7.93:cargo.position.y+1.7;spread.rotation.y=cargo.rotation.y;
if(p>=.975){spread.position.set(32,16,279.3);spread.rotation.y=0}
trolley.visible=spread.visible;trolley.position.z=spread.position.z-261;hoist.visible=spread.visible;hoist.position.set(spread.position.x,17.25,spread.position.z);hoist.rotation.y=spread.rotation.y;
cables.forEach((c,i)=>{c.visible=spread.visible;let corner=new T.Vector3(i<2?-3.6:3.6,0,i%2?-1.3:1.3).applyAxisAngle(new T.Vector3(0,1,0),spread.rotation.y);const bottom=spread.position.y+.125,top=17.1;c.position.set(spread.position.x+corner.x,(top+bottom)/2,spread.position.z+corner.z);c.scale.y=Math.max(.01,top-bottom)});

let viewZ=-10+drive*259+ease(clamp((p-.85)/.15))*35;const factoryBlend=1-ease(clamp((raw-.19)/.10));viewZ=viewZ*(1-factoryBlend)+(-34)*factoryBlend;const mobile=innerWidth<700;const portBlend=ease(clamp((raw-.66)/.12));const zoom=Math.max(1,1.45/camera.aspect)*(1+portBlend*.15+factoryBlend*.18);const focusX=9+factoryBlend*8+portBlend*18;camera.position.set(focusX,(62-10*factoryBlend)*zoom,viewZ+42*zoom);scene.fog.near=85*zoom;scene.fog.far=170*zoom;camera.far=600;camera.updateProjectionMatrix();camera.lookAt(focusX,0,viewZ-4);sun.position.set(-30,80,viewZ-20);sun.target.position.set(0,0,viewZ);scene.add(sun.target);renderer.render(scene,camera)}requestAnimationFrame(frame);
