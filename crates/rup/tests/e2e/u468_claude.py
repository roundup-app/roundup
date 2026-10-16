#!/usr/bin/env python3
"""U468's deterministic native-form driver, separate from the real-Claude observer.

It calls the real rup MCP shim, renders its elicitation request, and reports typed
input from the primary program, as the observed native ElicitationResult does.
It implements no question routing or successful tool result of its own.
"""
import http.client
import json
import os
from pathlib import Path
import selectors
import socket
import subprocess
import sys
import tty
import termios

if sys.argv[1:3] == ['plugin', 'test']:
    print('Q11 runtime hook closure: 1 pass')
    sys.exit(0)


def flag(name):
    return sys.argv[sys.argv.index(name) + 1]


settings = json.load(open(flag('--settings')))


def hook(event, **fields):
    fields.update(hook_event_name=event)
    for group in settings['hooks'][event]:
        for item in group['hooks']:
            subprocess.run(item['command'], shell=True, input=json.dumps(fields), text=True, check=True)


def native(body):
    conn = http.client.HTTPConnection('roundup', timeout=5)
    conn.sock = socket.socket(socket.AF_UNIX)
    conn.sock.settimeout(5)
    conn.sock.connect(os.environ['RUPD_SOCKET'])
    conn.request('POST', '/terminal-question/answer', json.dumps(body), {'Content-Type': 'application/json'})
    response = conn.getresponse()
    result = {'status': response.status, 'body': response.read().decode()}
    conn.close()
    return result


def send(value):
    shim.stdin.write((json.dumps({'jsonrpc': '2.0', **value}) + '\n').encode())
    shim.stdin.flush()


def ask():
    global calls
    calls += 1
    send({'id': calls, 'method': 'tools/call', 'params': {'name': 'ask_user', 'arguments': {
        'question': 'Cats or dogs?', 'answers': [
            {'label': 'cats', 'description': 'Quiet'}, {'label': 'dogs', 'description': 'Walks'}
        ]}}})


tty.setraw(0)
attributes = termios.tcgetattr(0)
attributes[1] |= termios.OPOST | termios.ONLCR
termios.tcsetattr(0, termios.TCSANOW, attributes)
print('\033]0;✳ Ready\007', flush=True)
hook('SessionStart', session_id='00000000-0000-4000-8000-000000002048', source='startup')
initial = b''
while not initial.endswith(b'\r'):
    initial += os.read(0, 1)
hook('UserPromptSubmit', prompt=initial.decode().replace('\x1b[200~','').replace('\x1b[201~','').removeprefix('Follow this instruction: ').strip())
config = json.load(open(flag('--mcp-config')))['mcpServers']['roundup']
shim = subprocess.Popen([config['command'], *config['args']], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
send({'id': 'init', 'method': 'initialize', 'params': {
    'protocolVersion': '2025-11-25', 'capabilities': {'elicitation': {'form': {}}},
    'clientInfo': {'name': 'u468-native-fixture', 'version': '1'}
}})
assert json.loads(shim.stdout.readline())['result']['protocolVersion'] == '2025-11-25'
send({'method': 'notifications/initialized'})
calls = 0
forms = {}
active = None
pending = b''
wire = b''
is_door = '--tools' in sys.argv
hook('Stop')
print('READY', flush=True)
if not is_door:
    ask()
selector = selectors.DefaultSelector()
selector.register(0, selectors.EVENT_READ, 'terminal')
selector.register(shim.stdout, selectors.EVENT_READ, 'mcp')
try:
    while True:
        for selected, _ in selector.select(timeout=10):
            data = os.read(selected.fd, 65536)
            if not data:
                sys.exit(0)
            if selected.data == 'mcp':
                wire += data
                while b'\n' in wire:
                    line, wire = wire.split(b'\n', 1)
                    message = json.loads(line)
                    if message.get('method') == 'elicitation/create':
                        params = message['params']
                        field = next(key for key in params['requestedSchema']['properties'] if key.startswith('roundup_d'))
                        active = field.removeprefix('roundup_')
                        forms[active] = (message['id'], field)
                        print(params['message'].replace('\n', '\r\n'), flush=True)
                        print('FORM READY ' + active, flush=True)
                    elif message.get('method') == 'notifications/cancelled':
                        print('FORM CANCELLED ' + str(message['params']['requestId']), flush=True)
                    elif 'result' in message or 'error' in message:
                        result = message.get('result', message.get('error'))
                        Path('returned-' + str(message['id']) + '.json').write_text(json.dumps(result))
                        print('RETURN ' + str(message['id']), flush=True)
                        if isinstance(message.get('id'), int):
                            hook('PostToolUse', tool_name='mcp__roundup__ask_user')
                            hook('Stop')
                            print('RESUMED ' + str(message['id']), flush=True)
            else:
                for byte in data:
                    if is_door and byte not in (1, 2, 4, 5, 6):
                        if byte == 13:
                            print('DOOR STEER READ', flush=True)
                        continue
                    if byte == 2:
                        ask()
                    elif byte == 1:
                        body = json.load(open('native-response.json'))
                        print('PROBE ' + json.dumps(native(body)), flush=True)
                    elif byte == 4:
                        # A tool subprocess with the same request text gets no native authority.
                        body = json.load(open('native-response.json'))
                        child = subprocess.run([sys.executable, '-c', '''import http.client,json,os,socket,sys
c=http.client.HTTPConnection('roundup',timeout=5);c.sock=socket.socket(socket.AF_UNIX);c.sock.connect(os.environ['RUPD_SOCKET'])
c.request('POST','/terminal-question/answer',sys.argv[1],{'Content-Type':'application/json'})
r=c.getresponse();print(json.dumps({'status':r.status,'body':r.read().decode()}))''', json.dumps(body)], stdout=subprocess.PIPE, text=True, check=True)
                        print('SUBPROCESS ' + child.stdout.strip(), flush=True)
                    elif byte == 5:
                        # A real Door invokes the offered direct tool from its own MCP shim.
                        body = json.load(open('door-answer.json'))
                        send({'id': 'door-answer', 'method': 'tools/call', 'params': {'name': 'decision_answer', 'arguments': body}})
                    elif byte == 6:
                        body = json.load(open('peer-call.json'))
                        child = subprocess.run([sys.executable, '-c', '''import json,os,socket,sys
s=socket.socket(socket.AF_UNIX);s.connect(os.environ['RUPD_SOCKET']);f=s.makefile('r')
for i,(m,p) in enumerate([('daemon.identify',{'actor':{'kind':'user','id':'you'}}),tuple(json.loads(sys.argv[1]))]):
 s.sendall((json.dumps({'jsonrpc':'2.0','id':i,'method':m,'params':p})+'\\n').encode());r=json.loads(f.readline())
print(json.dumps(r))''', json.dumps(body)], stdout=subprocess.PIPE, text=True, check=True)
                        print('PEER ' + child.stdout.strip(), flush=True)
                    elif byte == 27:
                        request, _ = forms[active]
                        send({'id': request, 'result': {'action': 'cancel'}})
                        print('DISMISSED ' + active, flush=True)
                    elif byte == 13:
                        text = pending.decode()
                        pending = b''
                        request, field = forms[active]
                        reply = native({'id': active, 'text': text, 'note': ''})
                        print('NATIVE ' + json.dumps(reply), flush=True)
                        send({'id': request, 'result': {'action': 'accept', 'content': {field: text}}})
                    else:
                        pending += bytes([byte])
                        print('INPUT ' + pending.decode(), flush=True)
finally:
    shim.terminate()
    shim.wait(timeout=5)
