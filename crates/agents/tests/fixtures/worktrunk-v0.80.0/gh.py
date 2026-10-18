#!/usr/bin/python3
import sys,json
if '--version' in sys.argv: print('gh version 2.87.3 (fixture)')
elif sys.argv[1:3]==['pr','list']: print(json.dumps([{'number':42,'title':'Fixture PR','body':'','headRefOid':'5a866f5d576153de76eb4abe576de55e56375d0a','mergeStateStatus':'CLEAN','statusCheckRollup':[{'status':'COMPLETED','conclusion':'SUCCESS'}],'url':'https://github.com/fixture/collector/pull/42','headRepositoryOwner':{'login':'fixture'},'reviewDecision':'CHANGES_REQUESTED','isDraft':False}]))
else: print('[]')
