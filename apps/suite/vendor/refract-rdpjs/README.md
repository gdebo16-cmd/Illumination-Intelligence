refract-rdpjs
=============

Vendored copy of @electerm/rdpjs 1.0.0 (npm; a fork of node-rdpjs by Sylvain Peyrefitte, via MeshCentral).
License: GPL-3.0 (see LICENSE and rdp/LICENSE). Used only on the server by lib/refract/remote.ts, which
loads it at run time (not bundled) to talk to the Refract VM's VirtualBox remote display on 127.0.0.1.

Local patches (compare with the @electerm/rdpjs 1.0.0 npm tarball):
1. rdp/protocol/t125/mcs.js   - ignore data on MCS channels this client never joined instead of crashing
                                 (VirtualBox VRDP sends virtual-channel data the library doesn't handle).
2. rdp/protocol/pdu/data.js   - Font Map PDU fields are optional (VRDP sends a short one).
3. rdp/protocol/rdp.js        - bitmap events say whether the data was decompressed (RGBA, top-down) or raw.
4. rdp/protocol/x224.js       - refuse NLA (HYBRID) instead of loading node-forge, which isn't installed.