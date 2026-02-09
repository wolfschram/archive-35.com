#!/usr/bin/env python3
"""Archive-35 MCP Server - Gives Claude direct repo access"""
import os,sys,json,subprocess
try:
    from mcp.server.fastmcp import FastMCP
    from pydantic import BaseModel,Field
except ImportError:
    print('pip3 install "mcp[cli]" httpx --break-system-packages',file=sys.stderr);sys.exit(1)

ROOT=os.environ.get('ARCHIVE35_ROOT',os.path.expanduser('~/Documents/Archive-35.com'))
mcp=FastMCP('archive35_mcp')

def safe(p):
    r=os.path.normpath(os.path.join(ROOT,p))
    assert r.startswith(ROOT),'Path traversal'
    return r

def git(*a):
    # Auto-clean stale git lock files before any operation
    import glob as _g
    for lf in _g.glob(os.path.join(ROOT,'.git','*.lock'))+_g.glob(os.path.join(ROOT,'.git','refs','**','*.lock'),recursive=True):
        try: os.remove(lf)
        except: pass
    r=subprocess.run(['git']+list(a),cwd=ROOT,capture_output=True,text=True,timeout=30)
    return r.stdout.strip() or r.stderr.strip() or '(none)'

class FileIn(BaseModel):
    path:str=Field(...,description='Relative path from repo root')
    line_start:int|None=Field(default=None,description='Start line (1-indexed)')
    line_end:int|None=Field(default=None,description='End line')

class WriteIn(BaseModel):
    path:str=Field(...,description='Relative path')
    content:str=Field(...,description='File content')

class EditIn(BaseModel):
    path:str=Field(...,description='Relative path')
    old_text:str=Field(...,description='Text to find')
    new_text:str=Field(...,description='Replacement')
    replace_all:bool=Field(default=False)

class SearchIn(BaseModel):
    pattern:str=Field(...,description='Grep pattern')
    glob:str|None=Field(default=None,description='File glob (e.g. *.js)')

class CommitIn(BaseModel):
    message:str=Field(...,description='Commit message')
    files:list[str]|None=Field(default=None,description='Files to stage (None=all)')
    push:bool=Field(default=False)

class ShellIn(BaseModel):
    command:str=Field(...,description='Shell command')
    timeout:int=Field(default=30)

class ListIn(BaseModel):
    path:str=Field(default='.',description='Directory path')
    recursive:bool=Field(default=False)

@mcp.tool(name='archive35_read_file')
async def read_file(p:FileIn)->str:
    '''Read a file from the Archive-35 repo.'''
    try:
        f=safe(p.path)
        if not os.path.exists(f): return f'Error: {p.path} not found'
        with open(f,'r',errors='replace') as fh: lines=fh.readlines()
        s=(p.line_start or 1)-1; e=p.line_end or len(lines)
        numbered=[f'{i+s+1:4d} | {l.rstrip()}' for i,l in enumerate(lines[s:e])]
        return f'# {p.path} ({len(lines)} lines)\n' + '\n'.join(numbered)
    except Exception as e: return f'Error: {e}'

@mcp.tool(name='archive35_write_file')
async def write_file(p:WriteIn)->str:
    '''Write/create a file in the repo.'''
    try:
        f=safe(p.path); os.makedirs(os.path.dirname(f),exist_ok=True)
        with open(f,'w') as fh: fh.write(p.content)
        return f'Written: {p.path} ({os.path.getsize(f):,} bytes)'
    except Exception as e: return f'Error: {e}'

@mcp.tool(name='archive35_edit_file')
async def edit_file(p:EditIn)->str:
    '''Find and replace text in a file.'''
    try:
        f=safe(p.path)
        with open(f,'r') as fh: c=fh.read()
        if p.old_text not in c: return f'Error: Text not found in {p.path}'
        n=c.count(p.old_text) if p.replace_all else 1
        c=c.replace(p.old_text,p.new_text) if p.replace_all else c.replace(p.old_text,p.new_text,1)
        with open(f,'w') as fh: fh.write(c)
        return f'Edited: {p.path} ({n} replacements)'
    except Exception as e: return f'Error: {e}'

@mcp.tool(name='archive35_list_dir')
async def list_dir(p:ListIn)->str:
    '''List directory contents.'''
    try:
        d=safe(p.path); items=[]; skip={'.git','node_modules','Photography','__pycache__'}
        def _ls(path,depth,prefix=''):
            if depth>3: return
            for e in sorted(os.listdir(path)):
                if e in skip or e.startswith('.'): continue
                full=os.path.join(path,e)
                if os.path.isdir(full):
                    items.append(f'{prefix}{e}/')
                    if p.recursive: _ls(full,depth+1,prefix+'  ')
                else:
                    sz=os.path.getsize(full)
                    items.append(f'{prefix}{e} ({sz:,} B)')
        _ls(d,1)
        return f'# {p.path} ({len(items)} items)\n'+'\n'.join(items)
    except Exception as e: return f'Error: {e}'

@mcp.tool(name='archive35_search_code')
async def search_code(p:SearchIn)->str:
    '''Search code with grep.'''
    try:
        cmd=['grep','-rn','--color=never']
        if p.glob: cmd.extend(['--include',p.glob])
        for x in ['.git','node_modules','Photography']: cmd.extend(['--exclude-dir',x])
        cmd.extend([p.pattern,ROOT])
        r=subprocess.run(cmd,capture_output=True,text=True,timeout=15)
        lines=[(l.replace(ROOT+'/','')) for l in (r.stdout.strip().split('\n') if r.stdout.strip() else [])][:50]
        return f'# Search: {p.pattern} ({len(lines)} matches)\n'+'\n'.join(lines) if lines else f'No matches for: {p.pattern}'
    except Exception as e: return f'Error: {e}'

@mcp.tool(name='archive35_git_status')
async def git_status()->str:
    '''Git status, branch, recent commits.'''
    return f'# Git Status\n**Branch**: {git("branch","--show-current")}\n**Log**:\n{git("log","--oneline","-5")}\n**Status**:\n{git("status","--short") or "(clean)"}'

@mcp.tool(name='archive35_git_diff')
async def git_diff()->str:
    '''Show all uncommitted changes.'''
    d=git('diff','HEAD')
    return f'```diff\n{d[:8000]}\n```' if d else 'No changes'

@mcp.tool(name='archive35_git_commit')
async def git_commit(p:CommitIn)->str:
    '''Stage, commit, optionally push.'''
    try:
        if p.files:
            for f in p.files: git('add',f)
        else: git('add','-A')
        r=git('commit','-m',p.message)
        out=f'Commit: {r}'
        if p.push: out+=f'\nPush: {git("push","origin","main")}'
        return out
    except Exception as e: return f'Error: {e}'

@mcp.tool(name='archive35_run_command')
async def run_command(p:ShellIn)->str:
    '''Run a shell command in the repo directory.'''
    try:
        r=subprocess.run(p.command,shell=True,cwd=ROOT,capture_output=True,text=True,timeout=p.timeout)
        o=r.stdout.strip()
        if r.stderr.strip(): o+=f'\nSTDERR: {r.stderr.strip()}'
        return o or '(no output)'
    except Exception as e: return f'Error: {e}'

@mcp.tool(name='archive35_overview')
async def overview()->str:
    '''Quick project overview.'''
    b=git('branch','--show-current'); l=git('log','--oneline','-3'); s=git('status','--short')
    keys=['js/main.js','data/photos.json','contact.html','search.html','index.html']
    k='\n'.join(f'  {f}: {os.path.getsize(os.path.join(ROOT,f)):,} B' if os.path.exists(os.path.join(ROOT,f)) else f'  {f}: MISSING' for f in keys)
    return f'# Archive-35 Overview\n**Root**: {ROOT}\n**Branch**: {b}\n{l}\n\n**Status**: {s or "(clean)"}\n\n**Key files**:\n{k}'

if __name__=='__main__': mcp.run()
