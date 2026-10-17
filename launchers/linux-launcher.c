#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <limits.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <errno.h>
/* Native ELF entry: never relies on .desktop or shell-script file associations. */
static int attempt(char *const args[]) {
 pid_t p=fork();if(p<0)return 127;
 if(p==0){execvp(args[0],args);_exit(127);}
 int status;while(waitpid(p,&status,0)<0){if(errno!=EINTR)return 127;}
 return WIFEXITED(status)?WEXITSTATUS(status):1;
}
int main(int argc,char **argv){
 char root[PATH_MAX],node[PATH_MAX],script[PATH_MAX],desktop[PATH_MAX];
 ssize_t n=readlink("/proc/self/exe",root,sizeof(root)-1);if(n<0){perror("launcher path");return 1;}root[n]=0;
 char *slash=strrchr(root,'/');if(!slash)return 1;*slash=0;
 if(snprintf(node,sizeof(node),"%s/runtime/node",root)>=(int)sizeof(node)||snprintf(script,sizeof(script),"%s/START-REMOTE.sh",root)>=(int)sizeof(script)||snprintf(desktop,sizeof(desktop),"%s/launchers/desktop.cjs",root)>=(int)sizeof(desktop))return 1;
 if(argc>1&&!strcmp(argv[1],"--check")){execl(node,node,"--version",NULL);perror("bundled runtime");return 1;}
 if(argc>1&&!strcmp(argv[1],"--install-desktop")){execl(node,node,desktop,NULL);perror("desktop installer");return 1;}
 if(!isatty(STDOUT_FILENO)&&(getenv("DISPLAY")||getenv("WAYLAND_DISPLAY"))){
  char *a[]={"x-terminal-emulator","-e","/bin/sh",script,NULL};int code=attempt(a);if(code!=127)return code;
  char *b[]={"gnome-terminal","--wait","--","/bin/sh",script,NULL};code=attempt(b);if(code!=127)return code;
  char *c[]={"konsole","--nofork","-e","/bin/sh",script,NULL};code=attempt(c);if(code!=127)return code;
  char *d[]={"xfce4-terminal","--disable-server","-x","/bin/sh",script,NULL};code=attempt(d);if(code!=127)return code;
  char *e[]={"xterm","-e","/bin/sh",script,NULL};code=attempt(e);if(code!=127)return code;
  char *f[]={"zenity","--error","--text=No terminal application found. Open a terminal in the extracted folder and run ./SSH-Remote.",NULL};attempt(f);
  fputs("No terminal application found.\n",stderr);return 1;
 }
 execl("/bin/sh","sh",script,(argc>1&&!strcmp(argv[1],"--no-desktop"))?"--no-desktop":NULL,NULL);
 perror("remote launcher");return 1;
}
