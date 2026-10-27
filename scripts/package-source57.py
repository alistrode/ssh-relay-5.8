#!/usr/bin/env python3
"""Archive committed source without historical run bundles or private runtime state."""
import argparse,subprocess,tarfile,zipfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--revision',default='HEAD');p.add_argument('--output',type=Path,required=True);a=p.parse_args()
a.output.parent.mkdir(parents=True,exist_ok=True)
revision=subprocess.check_output(['git','rev-parse','--verify',a.revision+'^{commit}'],cwd=root,text=True).strip()
process=subprocess.Popen(['git','archive','--format=tar',revision],cwd=root,stdout=subprocess.PIPE)
try:
 with tarfile.open(fileobj=process.stdout,mode='r|') as archive,zipfile.ZipFile(a.output,'w',zipfile.ZIP_DEFLATED) as out:
  for item in archive:
   if not item.isfile() or Path(item.name).parts[0] in {'packages','run-records','run-output','node_modules','dist'}:continue
   data=archive.extractfile(item)
   if data:out.writestr('SSHRelayPro-5.7-source/'+item.name,data.read())
finally:
 process.stdout.close()
 if process.wait():raise RuntimeError('git archive failed')
print(a.output)
