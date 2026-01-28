# Installation Guide for Ubuntu 24.04

This guide details the steps to deploy the Journals application on Ubuntu 24.04 using Nginx as a reverse proxy, Gunicorn for the Django backend, and Node.js for the Angular SSR frontend.

**Target Domain:** `kejol.otcloud.co.ke`

## 0. Configure Swap Space (Crucial)

**IMPORTANT:** If your server has less than 8GB of RAM, you **MUST** configure swap space. The Angular build process and Elasticsearch will likely crash the server without it.

Run these commands to add 4GB of swap:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 1. Prerequisites

Update your system and install necessary packages:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y python3-venv python3-dev python3-pip nodejs npm nginx mysql-server libmysqlclient-dev pkg-config git certbot python3-certbot-nginx
```

Ensure Node.js is version 20 or higher:
```bash
node -v
```
If needed, install a newer version:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

## 2. Elasticsearch Setup

1.  Import the Elasticsearch PGP Key:
    ```bash
    wget -qO - https://artifacts.elastic.co/GPG-KEY-elasticsearch | sudo gpg --dearmor -o /usr/share/keyrings/elasticsearch-keyring.gpg
    ```

2.  Add the repository:
    ```bash
    echo "deb [signed-by=/usr/share/keyrings/elasticsearch-keyring.gpg] https://artifacts.elastic.co/packages/8.x/apt stable main" | sudo tee /etc/apt/sources.list.d/elastic-8.x.list
    ```

3.  Install Elasticsearch:
    ```bash
    sudo apt update
    sudo apt install -y elasticsearch
    ```

4.  Start and enable the service:
    ```bash
    sudo systemctl start elasticsearch
    sudo systemctl enable elasticsearch
    ```

5.  Reset the `elastic` user password (save this for `my_secrets.py`):
    ```bash
    sudo /usr/share/elasticsearch/bin/elasticsearch-reset-password -u elastic
    ```

## 3. Database Setup

1.  Log in to MySQL:
    ```bash
    sudo mysql
    ```

2.  Create the database and user (replace `your_password` with a strong password):
    ```sql
    CREATE DATABASE journals_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    CREATE USER 'journals_user'@'localhost' IDENTIFIED BY 'your_password';
    GRANT ALL PRIVILEGES ON journals_db.* TO 'journals_user'@'localhost';
    FLUSH PRIVILEGES;
    EXIT;
    ```

## 4. Backend Setup

1.  Navigate to the project root (e.g., `/var/www/journals-ke`):
    ```bash
    cd /var/www/journals-ke
    ```

2.  Create a virtual environment and activate it:
    ```bash
    python3 -m venv venv
    source venv/bin/activate
    ```

3.  Install Python dependencies (includes Gunicorn):
    ```bash
    pip install -r requirements.txt
    ```

4.  Configure secrets:
    -   Copy `my_secrets.example.py` to `my_secrets.py`.
    -   Edit `my_secrets.py` and update:
        -   Database credentials (`db_name`, `db_user`, `db_password`)
        -   Elasticsearch settings (`ELASTICSEARCH_DSL`)

5.  Run migrations and collect static files:
    ```bash
    python manage.py migrate
    python manage.py collectstatic --noinput
    ```

6.  Build the Elasticsearch index:
    ```bash
    python manage.py search_index --rebuild
    ```

7.  **Setup Gunicorn Service**:
    Create `/etc/systemd/system/journals-backend.service`:

    ```ini
    [Unit]
    Description=Gunicorn daemon for Journals Backend
    After=network.target

    [Service]
    User=www-data
    Group=www-data
    WorkingDirectory=/var/www/journals-ke
    # Adjust the path to gunicorn if different
    ExecStart=/var/www/journals-ke/venv/bin/gunicorn --access-logfile - --workers 3 --bind 127.0.0.1:8000 server.wsgi:application

    [Install]
    WantedBy=multi-user.target
    ```

8.  Start and enable the backend service:
    ```bash
    sudo systemctl start journals-backend
    sudo systemctl enable journals-backend
    ```

## 5. Frontend Setup

1.  Navigate to the client directory:
    ```bash
    cd client
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

3.  **Build the Application**:
    *Note: This step requires significant RAM. Ensure you have configured swap space (Step 0).*
    ```bash
    npm run build
    ```

4.  **Setup Node.js SSR Service**:
    Create `/etc/systemd/system/journals-frontend.service`:

    ```ini
    [Unit]
    Description=Node.js SSR Server for Journals Frontend
    After=network.target

    [Service]
    User=www-data
    Group=www-data
    WorkingDirectory=/var/www/journals-ke/client
    Environment=PORT=4000
    # Ensure this path points to your node executable
    ExecStart=/usr/bin/node dist/client/server/server.mjs
    Restart=always

    [Install]
    WantedBy=multi-user.target
    ```

5.  Start and enable the frontend service:
    ```bash
    sudo systemctl start journals-frontend
    sudo systemctl enable journals-frontend
    ```

## 6. Nginx Configuration

1.  Create `/etc/nginx/sites-available/journals`:

    ```nginx
    server {
        listen 80;
        server_name kejol.otcloud.co.ke;

        client_max_body_size 50M;  # Allow larger file uploads

        # Static files for Django
        location /static/ {
            alias /var/www/journals-ke/static/;
        }

        # Media files for Django
        location /media/ {
            alias /var/www/journals-ke/media/;
        }

        # Backend API
        location /api {
            proxy_pass http://127.0.0.1:8000;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Django Admin
        location /admin {
            proxy_pass http://127.0.0.1:8000;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Frontend (Angular SSR)
        location / {
            proxy_pass http://127.0.0.1:4000;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            
            # WebSocket support
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }
    }
    ```

2.  Enable the site and restart Nginx:
    ```bash
    sudo ln -s /etc/nginx/sites-available/journals /etc/nginx/sites-enabled/
    sudo nginx -t
    sudo systemctl restart nginx
    ```

## 7. SSL Setup (HTTPS)

Secure your site with a free Let's Encrypt certificate:

```bash
sudo certbot --nginx -d kejol.otcloud.co.ke
```

Follow the prompts to configure HTTPS. Nginx will reload automatically.

## 8. Final Verification

1.  Ensure firewall allows traffic:
    ```bash
    sudo ufw allow 'Nginx Full'
    ```

2.  Visit `https://kejol.otcloud.co.ke` to verify the deployment.
