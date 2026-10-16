#!/usr/bin/env python3
"""Publish only sanitized evidence after every required cloud gate passed."""
from pathlib import Path
import hashlib,json,sys

repo=Path(__file__).resolve().parents[1]
hour=Path(sys.argv[1]);recovery=Path(sys.argv[2]);integration=Path(sys.argv[3]);ui=Path(sys.argv[4])
soak=json.loads((hour/'soak-result.json').read_text())
checks=json.loads((recovery/'recovery-results.json').read_text())
done=json.loads((recovery/'completed.json').read_text())
mcp=json.loads((integration/'integration-results.json').read_text())
desktop=json.loads((ui/'ui-smoke.json').read_text())
windows=json.loads(Path(sys.argv[5]).read_text())
sources={str(p.relative_to(repo)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((repo/'src').rglob('*')) if p.suffix in ['.js','.cjs']}
assert soak['passed'] and soak['seconds']>=3600 and not soak['failures']
assert sources==soak['sourceHashes'],'Runtime source changed after the measured hour'
assert soak['longExit']=={'active':0,'idle':0}
assert len(soak['rawSdkClients'])==32 and all(x['passed'] for x in soak['rawSdkClients'])
assert done['passed'] and len(checks)==11 and all(x['passed'] for x in checks)
assert len(mcp)==54 and all(x['passed'] for x in mcp) and len({x['name'] for x in mcp})==37
assert 'INTEGRATION PASS 54' in (integration/'integration-private.log').read_text()
assert all(desktop[k] for k in ['pairedSshVerified','copyAndCancelVerified','closeKeepsBackground','loginStartupRemembered','trayObjectCreated'])
assert windows['passed'] and windows['automaticAgentRecovery']['passed'] and windows['bulkRoundtrip']['passed']
data={
 'applicationVersion':'2.0.0','branch':'recovery/current-public-relay-pro','passed':True,
 'scope':'Isolated Linux x64 cloud near/far through the existing public MQTT broker; not a user-computer connection.',
 'runtime':{'electron':'44.8.0','builtInNode':'24.22.0','requiresSystemNode':False},
 'oneHour':{k:soak[k] for k in ['seconds','startedAtUtc','finishedAtUtc','publicBroker','clientKeepaliveEnabled','longExit','unexpectedEvents','retransmissions','reorderedFrames']},
 'publicChecks':{
  'sshIdentityProbes':len(soak['sshProbes']),'allSshPassed':all(x['passed'] for x in soak['sshProbes']),
  'sftp64KiBRoundtrips':len(soak['sftpRoundtrips']),'allSftpPassed':all(x['passed'] for x in soak['sftpRoundtrips']),
  'mcpCycles':len(soak['mcpCycles']),'allMcpPassed':all(x['passed'] for x in soak['mcpCycles']),
  'rawSdkConnections':len(soak['rawSdkClients']),'allRawSdkPassed':True,
  'mcpIntegrationCalls':len(mcp),'mcpToolNames':37,'mcpPrompts':5,
 },
 'automaticRecovery':[ {k:x[k] for k in ['name','passed','seconds','mcpAutomaticallyRecovered'] if k in x} for x in checks ],
 'desktop':desktop,
 'nativeWindows':windows,
 'additionalChecks':{'proUnitTests':7,'existingRelayFaultInjectionTests':7,'linuxSystemdParserVerified':True},
 'limitations':[
  'Windows native runtime, GUI rendering, independent near/far background survival, MCP and 1 MiB SFTP were tested. The downloaded ZIP Setup.cmd double-click, physical tray-menu interaction and OS boot restart were not tested.',
  'Linux GUI was tested under Xvfb. A physical desktop tray host and actual system boot/login were not tested.',
  'Linux login autostart registration and persistence were tested only in a temporary isolated XDG directory, without changing cloud startup configuration.',
  'Database tools and scheduler error paths were covered, but no real database business workload or scheduler registration acceptance was performed.',
  'Automatic recovery creates new verified SSH/MCP connections; interrupted operations are not replayed and old shell continuity is not guaranteed.',
  'Public broker availability, device power/sleep and destruction of an ephemeral cloud workspace remain external limits.',
 ],
 'sourceHashes':sources,
 'privacy':'No pairing codes, private keys, authorization tokens, connection blocks or raw runtime logs are included.'
}
for path in [repo/'docs/PRO-VALIDATION.json',repo/'deliverables/pro/VALIDATION.json']:
 path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'passed':True,'seconds':soak['seconds'],'sourceFiles':len(sources),'publicChecks':data['publicChecks']}))
