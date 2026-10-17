#!/usr/bin/env python3
"""Owned cloud near/far only; real public MQTT, no private credentials in output."""
from pathlib import Path
import sys,os,subprocess,json,time,socket,http.client,hashlib,secrets,datetime,signal
REPO=Path(__file__).resolve().parents[2];ROOT=Path(sys.argv[1]).resolve();NODE=sys.argv[2]if len(sys.argv)>2 else'node';ENV={**os.environ,'ELECTRON_RUN_AS_NODE':'1'};os.umask(0o077);ROOT.mkdir(parents=True,exist_ok=True)
roles={r:ROOT/r for r in ['near','far']};failures=[];probes=[];transfers=[];children=[];files=[];start=None;started=None;completed=False;source_before={str(p.relative_to(REPO)):hashlib.sha256(p.read_bytes()).hexdigest()for p in sorted((REPO/'src').rglob('*'))if p.suffix in ['.js','.cjs']};(ROOT/'source-before.json').write_text(json.dumps(source_before,indent=2));
def api(role,route,body=None):
 runtime=json.loads((roles[role]/'agent-runtime.json').read_text());c=http.client.HTTPConnection('127.0.0.1',runtime['port'],timeout=110);headers={'Authorization':'Bearer '+runtime['token'],'Content-Type':'application/json'}
 try:c.request('GET'if body is None else'POST',route,body=None if body is None else json.dumps(body),headers=headers);r=c.getresponse();data=json.loads(r.read());assert r.status==200,data.get('error');return data
 finally:c.close()
def launch(command,name):
 log=open(ROOT/name,'w');files.append(log);p=subprocess.Popen(command,env=ENV,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True);children.append(p);return p
try:
 for role,folder in roles.items():subprocess.run([NODE,str(REPO/'src/pro/cli.cjs'),'start','--role',role,'--state-dir',str(folder),'--allow-cloud-self-test'],env=ENV,stdin=subprocess.DEVNULL,capture_output=True,check=True,timeout=35)
 if not api('near','/status')['devices']:
  offer=api('far','/pair/create',{});api('near','/pair/connect',{'code':offer['code']});del offer
 for _ in range(150):
  state=api('near','/status');device=next((d for d in state['devices']if d['state']=='online'),None)
  if device:break
  time.sleep(1)
 else:raise RuntimeError('Initial pinned identity was not verified')
 report=json.loads(Path(device['connectionReport']).read_text());assert report['cloud_self_test'];(ROOT/'connection.json').write_text(json.dumps(report));
 # Run the existing complete 37-tool integration before starting the hour clock.
 preflight=ROOT/'preflight';preflight.mkdir(exist_ok=True)
 if len(sys.argv)>3:
  checks=json.loads(Path(sys.argv[3]).read_text());(preflight/'integration-results.json').write_text(json.dumps(checks));assert len(checks)==54 and all(x['passed']for x in checks)
 else:
  pre=launch([NODE,str(REPO/'tests/pro/mcp-integration.mjs'),str(preflight),str(ROOT/'connection.json')],'preflight.log');assert pre.wait(timeout=900)==0,'MCP preflight failed';checks=json.loads((preflight/'integration-results.json').read_text());assert len(checks)==54 and all(x['passed']for x in checks)
 print('PREFLIGHT PASS: 54 calls, 37 tools; starting owned long connections',flush=True)
 argv=report['ssh_argv'];argv=argv[:-1]+['-o','ServerAliveInterval=0',argv[-1]];long=[]
 commands={'active':'printf active-start; i=0; while [ "$i" -lt 241 ]; do printf "tick:%s\\n" "$i"; i=$((i+1)); sleep 15; done; printf active-complete','idle':'printf idle-start; sleep 3630; printf idle-complete'}
 for name,command in commands.items():
  out=open(ROOT/(name+'.stdout'),'w');err=open(ROOT/(name+'.stderr'),'w');files.extend([out,err]);p=subprocess.Popen(argv+[command],stdin=subprocess.DEVNULL,stdout=out,stderr=err,start_new_session=True);children.append(p);long.append((name,p))
 for _ in range(200):
  if all(name+'-start'in(ROOT/(name+'.stdout')).read_text()for name,_ in long):break
  if any(p.poll()is not None for _,p in long):raise RuntimeError('Long connection failed to start')
  time.sleep(.5)
 else:raise RuntimeError('Long connection markers not received')
 started=datetime.datetime.now(datetime.timezone.utc).isoformat();start=time.monotonic();(ROOT/'started.json').write_text(json.dumps({'startedAtUtc':started,'harnessPid':os.getpid(),'cloudSelfTest':True,'sourceHashes':source_before},indent=2));print('HOUR START',started,flush=True)
 sdk=launch([NODE,str(REPO/'tests/pro/public-clients.cjs'),str(ROOT/'connection.json'),str(ROOT/'clients-results.json'),str(roles['far']/'agent-events.jsonl')],'clients.log')
 mcp=launch([NODE,str(REPO/'tests/pro/mcp-soak.mjs'),str(ROOT)],'mcp-soak.log');iteration=0;last_probe=0
 while time.monotonic()-start<3600:
  elapsed=time.monotonic()-start
  if any(p.poll()is not None for _,p in long):raise RuntimeError('A long connection closed before completing the hour')
  status=api('near','/status');current=next(d for d in status['devices']if d['id']==device['id']);assert current['state']=='online','Background unexpectedly left online state'
  if sdk.poll()is not None:
   assert sdk.returncode==0,'Raw SDK concurrency test failed'
   if elapsed-last_probe>=30:
    nonce=secrets.token_hex(12);p=subprocess.run(argv+['printf "%s\\n" '+nonce+'; whoami; hostname'],stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=65);ok=p.returncode==0 and nonce in p.stdout and report['remote_hostname']in p.stdout;probes.append({'seconds':elapsed,'passed':ok,'exit':p.returncode});assert ok,'SSH identity probe failed'
    if iteration%3==0:
     data=os.urandom(65536);source=ROOT/'upload.bin';source.write_bytes(data);target=str(ROOT/('remote-'+nonce+'.bin'));download=ROOT/'download.bin';download.unlink(missing_ok=True);batch=ROOT/'sftp.batch';batch.write_text(f'put "{source}" "{target}"\nget "{target}" "{download}"\nrm "{target}"\n');sftp=['sftp']+report['ssh_argv'][1:-1];sftp[sftp.index('-p')]='-P';sftp+=['-b',str(batch),report['ssh_argv'][-1]];p=subprocess.run(sftp,stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=100);ok=p.returncode==0 and download.exists()and download.read_bytes()==data;transfers.append({'seconds':time.monotonic()-start,'passed':ok,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()});assert ok,'SFTP content roundtrip failed'
    iteration+=1;last_probe=time.monotonic()-start
  if mcp.poll()is not None:raise RuntimeError('MCP soak process exited early')
  rows=json.loads((ROOT/'mcp-soak-results.json').read_text())if(ROOT/'mcp-soak-results.json').exists()else[];assert all(x['passed']for x in rows),'MCP probe failed'
  print(json.dumps({'seconds':int(time.monotonic()-start),'ssh':len(probes),'sftp':len(transfers),'mcp':len(rows),'rawClientsRunning':sdk.poll()is None,'long':{n:p.poll()for n,p in long},'failures':len(failures)}),flush=True)
  until=min(start+3600,time.monotonic()+30)
  while time.monotonic()<until:time.sleep(min(1,until-time.monotonic()))
 assert sdk.poll()==0,'Concurrency test did not complete successfully'
 for name,p in long:
  p.wait(timeout=60);assert p.returncode==0 and name+'-complete'in(ROOT/(name+'.stdout')).read_text(),name+' did not finish normally'
 (ROOT/'stop-mcp').write_text('stop');mcp.wait(timeout=60);assert mcp.returncode==0;completed=True
except Exception as error:failures.append(str(error))
finally:
 (ROOT/'stop-mcp').write_text('stop')
 for p in children:
  if p.poll()is None:
   try:os.killpg(p.pid,signal.SIGTERM)
   except ProcessLookupError:pass
  try:p.wait(timeout=10)
  except subprocess.TimeoutExpired:p.kill();p.wait()
 for f in files:f.close()
 end=datetime.datetime.now(datetime.timezone.utc);events=[]
 for role,folder in roles.items():
  for name in ['agent-events.jsonl.3','agent-events.jsonl.2','agent-events.jsonl.1','agent-events.jsonl']:
   p=folder/name
   if p.exists():
    for line in p.read_text().splitlines():
     try:
      e=json.loads(line)
      if started and datetime.datetime.fromisoformat(e['time'].replace('Z','+00:00'))>=datetime.datetime.fromisoformat(started):events.append(e)
     except(ValueError,KeyError):pass
 bad=[e for e in events if e['event']in ['connection_failed','worker_exited']or e.get('trace',{}).get('event')in ['mqtt_offline']or e.get('trace',{}).get('reason')in ['delivery_ack_timeout','receive_window_exceeded','invalid_stream_frame','invalid_data_state','local_write_failed']]
 if bad:failures.append('Unexpected runtime disconnect or worker exit during the measured hour')
 source_after={str(p.relative_to(REPO)):hashlib.sha256(p.read_bytes()).hexdigest()for p in sorted((REPO/'src').rglob('*'))if p.suffix in ['.js','.cjs']}
 if source_before!=source_after:failures.append('Application source changed during this run; hour must be restarted')
 mcp_results=json.loads((ROOT/'mcp-soak-results.json').read_text())if(ROOT/'mcp-soak-results.json').exists()else[];clients=json.loads((ROOT/'clients-results.json').read_text())if(ROOT/'clients-results.json').exists()else[]
 result={'passed':completed and not failures and start is not None,'seconds':time.monotonic()-start if start else 0,'startedAtUtc':started,'finishedAtUtc':end.isoformat(),'failures':failures,'sshProbes':probes,'sftpRoundtrips':transfers,'mcpCycles':mcp_results,'rawSdkClients':clients,'longExit':{n:p.returncode for n,p in locals().get('long',[])},'clientKeepaliveEnabled':False,'cloudSelfTest':True,'publicBroker':'wss://broker.emqx.io:8084/mqtt','runtimeExecutable':NODE,'sourceHashes':source_before,'unexpectedEvents':len(bad),'retransmissions':sum(e.get('trace',{}).get('event')=='retransmit'for e in events),'reorderedFrames':sum(e.get('trace',{}).get('event')=='frame_buffered'for e in events)}
 (ROOT/'soak-result.json').write_text(json.dumps(result,indent=2));print('RESULT',json.dumps({k:v for k,v in result.items()if k not in ['sourceHashes','sshProbes','sftpRoundtrips','mcpCycles','rawSdkClients']}),flush=True)
 for role in roles:
  try:api(role,'/shutdown',{})
  except Exception:pass
 if not result['passed']:raise SystemExit(1)
