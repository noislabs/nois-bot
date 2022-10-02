# Run bot on server

Notes how to run this bot on an Ubuntu server without docker virtualization.

```sh
sudo apt update && sudo apt upgrade -y && sudo reboot

# Node is restarting ...

sudo apt install -y git htop joe

wget -O nodejs.deb https://deb.nodesource.com/node_16.x/pool/main/n/nodejs/nodejs_16.17.1-deb-1nodesource1_amd64.deb \
  && sudo dpkg -i nodejs.deb \
  && npm install pm2 -g

git clone https://github.com/noislabs/nois-bot.git \
  && cd nois-bot \
  && npm install

# Configure
cp .env.example .env

# Now adjust .env to your needs

# Start
pm2 start index.js

# Check status
pm2 ls
pm2 logs --lines 100
```
