"""Provision only fresh loopback databases on disposable Actions runners."""
import os,sys,pathlib,subprocess,socket,time,json,urllib.request,zipfile,tarfile,hashlib,shutil,getpass
root=pathlib.Path(os.environ['RUNNER_TEMP'])/'relay-ai-databases';root.mkdir(exist_ok=False)
windows=sys.platform=='win32';paths=[];downloads=[];children=[]
def download(url):
    target=root/url.rsplit('/',1)[1];urllib.request.urlretrieve(url,target)
    downloads.append({'url':url,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
    destination=root/(target.name+'.extracted');destination.mkdir()
    if target.suffix=='.zip':
        with zipfile.ZipFile(target) as archive:archive.extractall(destination)
    else:
        with tarfile.open(target) as archive:archive.extractall(destination,filter='data')
    for file in destination.rglob('*'):
        if file.name in ['mongod','mongod.exe','mongosh','mongosh.exe','mongosh.cmd','mongodump','mongodump.exe','mysql.exe','psql.exe']:
            if str(file.parent) not in paths:paths.append(str(file.parent))
def locate(name,roots=()):
    found=shutil.which(name)
    if found:return found
    suffix='.exe'if windows else''
    for parent in roots:
        parent=pathlib.Path(parent)
        if parent.exists():
            matches=list(parent.rglob(name+suffix))
            if matches:
                paths.append(str(matches[-1].parent));return str(matches[-1])
    return None
def run(args,**kw):
    r=subprocess.run([str(a)for a in args],capture_output=True,text=True,timeout=120,**kw)
    if r.returncode:raise RuntimeError(pathlib.Path(args[0]).name+' fixture setup failed: '+r.stderr[-1200:])
    return r.stdout
def port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def launch(args,name,p):
    log=open(root/(name+'.log'),'w');child=subprocess.Popen([str(a)for a in args],stdout=log,stderr=log,stdin=subprocess.DEVNULL);children.append(child)
    end=time.monotonic()+90
    while time.monotonic()<end:
        if child.poll()is not None:raise RuntimeError(name+' daemon exited; '+(root/(name+'.log')).read_text(errors='replace')[-1800:])
        try:
            with socket.create_connection(('127.0.0.1',p),timeout=1):return
        except OSError:time.sleep(.5)
    raise RuntimeError(name+' startup timeout')
pgroot=[r'C:\Program Files\PostgreSQL']if windows else['/usr/lib/postgresql']
psql=locate('psql',pgroot)
mysqlroot=[r'C:\mysql',r'C:\Program Files\MySQL',r'C:\tools\mysql']if windows else['/usr/sbin']
mysql=locate('mysql',mysqlroot);mysqld=locate('mysqld',mysqlroot)
if windows and not(mysql and mysqld):
    download('https://dev.mysql.com/get/Downloads/MySQL-8.4/mysql-8.4.6-winx64.zip')
    mysql=locate('mysql',[root]);mysqld=locate('mysqld',[root])
if not(psql and mysql and mysqld):raise RuntimeError('Required PostgreSQL/MySQL runner binaries unavailable')
for executable in [psql,mysql,mysqld]:
    directory=str(pathlib.Path(executable).parent)
    if directory not in paths:paths.append(directory)
if windows:
    download('https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-8.0.16.zip')
    download('https://fastdl.mongodb.org/tools/db/mongodb-database-tools-windows-x86_64-100.13.0.zip')
    download('https://downloads.mongodb.com/compass/mongosh-2.5.9-win32-x64.zip')
else:
    download('https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2404-8.0.16.tgz')
    download('https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2404-x86_64-100.13.0.tgz')
    download('https://downloads.mongodb.com/compass/mongosh-2.5.9-linux-x64.tgz')
os.environ['PATH']=os.pathsep.join(paths)+os.pathsep+os.environ['PATH']
pgbin=pathlib.Path(psql).parent
if not(pgbin/('initdb.exe'if windows else'initdb')).exists():
    initializer=locate('initdb',pgroot)
    if not initializer:raise RuntimeError('Native PostgreSQL initdb unavailable')
    pgbin=pathlib.Path(initializer).parent;psql=str(pgbin/('psql.exe'if windows else'psql'));paths.insert(0,str(pgbin))
# Default ports and the actual account also exercise the original schedule API,
# which deliberately has no dbPort/dbUser parameters. Only disposable VMs.
if windows:
    run(['pwsh','-NoProfile','-Command',"Get-Service | Where-Object { $_.Name -match '^(mysql|postgresql)' } | Stop-Service -Force -ErrorAction SilentlyContinue"])
else:subprocess.run(['sudo','systemctl','stop','mysql','postgresql'],capture_output=True,timeout=60)
account=getpass.getuser();pgdata=root/'postgres';pgport=5432
run([pgbin/('initdb.exe'if windows else'initdb'),'-D',pgdata,'-U',account,'--auth=trust','--encoding=UTF8','--no-locale'])
launch([pgbin/('postgres.exe'if windows else'postgres'),'-D',pgdata,'-h','127.0.0.1','-p',pgport]+([]if windows else['-k',pgdata]),'postgres',pgport)
run([pgbin/('createdb.exe'if windows else'createdb'),'-h','127.0.0.1','-p',pgport,'-U',account,'relay_ai'])
run([psql,'-h','127.0.0.1','-p',pgport,'-U',account,'-d','relay_ai','-c',"CREATE TABLE ai_probe(value text); INSERT INTO ai_probe VALUES ('ai-database-marker');"])
mydata=root/'mysql';myport=3306
run([mysqld,'--no-defaults','--initialize-insecure','--datadir='+str(mydata)])
launch([mysqld,'--no-defaults','--datadir='+str(mydata),'--port='+str(myport),'--bind-address=127.0.0.1','--mysqlx=0','--pid-file='+str(root/'mysql.pid')]+([]if windows else['--socket='+str(root/'mysql.sock')]),'mysql',myport)
run([mysql,'--no-defaults','-h','127.0.0.1','-P',myport,'-u','root','-e',"CREATE DATABASE relay_ai; CREATE TABLE relay_ai.ai_probe(value varchar(100)); INSERT INTO relay_ai.ai_probe VALUES ('ai-database-marker');"])
safe_account=account.replace("'","''")
run([mysql,'--no-defaults','-h','127.0.0.1','-P',myport,'-u','root','-e',"CREATE USER IF NOT EXISTS '"+safe_account+"'@'localhost'; GRANT ALL ON relay_ai.* TO '"+safe_account+"'@'localhost';"])
mongodata=root/'mongo';mongodata.mkdir();mongoport=27017
launch([shutil.which('mongod'),'--dbpath',mongodata,'--bind_ip','127.0.0.1','--port',mongoport],'mongodb',mongoport)
mongosh=shutil.which('mongosh')or shutil.which('mongosh.exe')
if not mongosh:raise RuntimeError('mongosh executable missing')
run([mongosh,'--quiet','mongodb://127.0.0.1:'+str(mongoport)+'/relay_ai','--eval',"db.ai_probe.insertOne({value:'ai-database-marker'})"])
manifest={'postgresql':{'dbPort':pgport,'dbUser':account},'mysql':{'dbPort':myport,'dbUser':account},'mongodb':{'dbPort':mongoport}}
file=root/'fixture.json';file.write_text(json.dumps(manifest));os.chmod(file,0o600)
with open(os.environ['GITHUB_PATH'],'a')as f:f.write('\n'.join(paths)+'\n')
with open(os.environ['GITHUB_ENV'],'a')as f:f.write('RELAY_AI_DATABASES='+str(file)+'\n')
evidence=pathlib.Path('ai-results');evidence.mkdir(exist_ok=True)
(evidence/'database-dependencies.json').write_text(json.dumps({'downloads':downloads,'postgresql':run([psql,'--version']).strip(),'mysql':run([mysql,'--version']).strip(),'mongoVersion':'8.0.16','loopbackOnly':True},indent=2))
print('Three isolated loopback databases initialized; dependency hashes recorded')
