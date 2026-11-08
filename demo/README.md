# The demo portal

`amc-demo.rjana.in` lets anyone try the portal with the account printed in the
guide. It has sample exams to go through, and everything goes back to the same
state every night.

It is apart from production (`amc.rjana.in`) on purpose. A password printed on
a web page protects nothing, so the people signing in here must not be able to
reach a server that holds real students' marks, and what they run must not slow
down teachers marking real exams.

## How it works

The demo runs **production's images and compose files** from the amc-webapp
checkout on the server, as its own Docker project (`amcdemo`): its own
containers, network, volume, sign-in data and Cloudflare tunnel. It never builds
anything, so it adds no image to the disk, and amc-webapp needs no change for it.
After production's `./amc update`, the next reset picks up the new image.

| File | |
|---|---|
| `demo.sh` | `reset` (wipe and restore; also the first start), `check`, `stop`, or any compose command |
| `compose.demo.yml` | The limits, and the demo's public site for Caddy |
| `compose.disk.yml` | Puts the exams on the fixed-size disk |
| `caddy/site.caddy` | The public site: production's routes, plus the password lock |
| `demo.env.example` | The settings; `demo.env` on the server holds the tunnel's token |
| `make-seed.sh` | Makes `seed.tar.gz`, the sample exams (not kept in git) |

**The limits.** The app gets 512 MB of memory and 1 CPU, which a whole exam
stays well inside (it peaks around 245 MB). Exams live on a fixed 2 GB disk, so
uploads can't fill the server's. If visitors fill it, uploads fail until the
night's reset.

**The password lock.** Every visitor shares one account, so `caddy/site.caddy`
refuses `POST /auth/account`: nobody can change its password, or sign everyone
out, and lock the others out until night.

**What is still shared.** Visitors see each other's work, and one can delete a
sample exam until the reset. Nothing real is at stake, so this is accepted.

## Setting it up on a server

Production must already be running from `/opt/amc-webapp`, with its images built.

```sh
sudo mkdir -p /opt/amc-demo /opt/amc-demo-data/files
sudo chown -R "$USER" /opt/amc-demo /opt/amc-demo-data
git clone https://github.com/rjanain/amc-user-guide /opt/amc-demo
cd /opt/amc-demo/demo
cp demo.env.example demo.env && chmod 600 demo.env

# The fixed-size disk
truncate -s 2G /opt/amc-demo-data/files.img
mkfs.ext4 -q -F -m 0 /opt/amc-demo-data/files.img
echo '/opt/amc-demo-data/files.img /opt/amc-demo-data/files ext4 loop,noatime,nofail 0 0' | sudo tee -a /etc/fstab
sudo mount /opt/amc-demo-data/files

# seed.tar.gz: copy it here from where make-seed.sh ran
./demo.sh reset
```

The tunnel: in the Cloudflare dashboard, create a tunnel, give it the public
hostname `amc-demo.rjana.in` with the service `http://caddy:8091`, put its token
in `demo.env` as `AMC_TUNNEL_TOKEN`, then `./demo.sh up -d --no-build cloudflared`.
Without a token the demo is reachable only from the server itself. To open it
from a laptop: `ssh -L 8092:127.0.0.1:8092 server`, then https://localhost:8092.

The nightly reset, in the crontab (21:30 UTC is 03:00 in India):

```
30 21 * * * /opt/amc-demo/demo/demo.sh reset >> /opt/amc-demo-data/reset.log 2>&1
```

## Changing the sample exams

`make-seed.sh` builds them on the guide's test copy by running the capture, so
the demo and the guide's pictures show the same exams. Run it on a machine with
Docker and a checkout of amc-webapp, copy `seed.tar.gz` to `/opt/amc-demo/demo/`
on the server, and the next reset uses it. It holds only made-up students.

## Trying it on a laptop

Point `DEMO_ENV` at a copy of `demo.env.example` with `AMC_DEMO_FILES` left out
(a plain volume), your own `AMC_WEBAPP_DIR`, `AMC_DATA_DIR`, `AMC_PORT`,
`AMC_SITES` and `AMC_ORIGINS`, and `DEMO_NO_TUNNEL=1`. If your images have other
names, say `DEMO_EXTRA_COMPOSE=stack/compose.guide.yml` (an absolute path).
