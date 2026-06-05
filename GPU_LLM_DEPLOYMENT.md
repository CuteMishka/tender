# Развёртывание open-source LLM на GPU-сервере

Эта инструкция нужна, чтобы заменить Groq/Gemini на свою open-source модель на GPU.

Идея такая:

1. На GPU-сервере поднимается `vLLM`.
2. `vLLM` отдаёт OpenAI-compatible API:

```text
http://llm:8000/v1/chat/completions
```

3. `parser` и `tender-rag` продолжают использовать существующий Groq-compatible код, но фактически ходят не в Groq, а в локальный `vLLM`.

## 0. Важно про безопасность

Пароль от SSH уже был отправлен в чат. Его лучше поменять сразу после первого входа.

Не сохраняй SSH-пароль:

- в `.env`;
- в скриптах;
- в Git;
- в истории команд.

Заходи так, пароль вводи вручную:

```bash
ssh cloud-user@85.116.182.35
```

После входа поменяй пароль:

```bash
passwd
```

## 1. Подключиться к серверу

На Windows открой PowerShell или терминал IDE и выполни:

```bash
ssh cloud-user@85.116.182.35
```

Если спросит:

```text
Are you sure you want to continue connecting?
```

ответь:

```text
yes
```

Потом введи пароль вручную.

## 2. Проверить операционную систему

На сервере выполни:

```bash
cat /etc/os-release
```

Это покажет, какая ОС стоит: Ubuntu, Debian, Rocky, AlmaLinux, CentOS и т.д.

## 3. Проверить GPU

Выполни:

```bash
nvidia-smi
```

Нужно посмотреть:

- название GPU;
- объём памяти `Memory-Usage`;
- версию драйвера.

Можно вывести коротко:

```bash
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
```

Примеры:

```text
NVIDIA A10, 23028 MiB, 550.xx
NVIDIA L4, 23034 MiB, 550.xx
NVIDIA T4, 15360 MiB, 535.xx
```

## 4. Какую модель выбрать

Выбор зависит от VRAM.

| VRAM GPU | Рекомендуемая модель | Комментарий |
|---:|---|---|
| 8-12 GB | `Qwen/Qwen2.5-3B-Instruct` | Самый безопасный старт для слабой GPU |
| 16 GB | `Qwen/Qwen2.5-3B-Instruct` или `Qwen/Qwen2.5-7B-Instruct` | 7B может быть тесно, лучше начать с 3B |
| 20-24 GB | `Qwen/Qwen2.5-7B-Instruct` | Оптимальный вариант для проекта |
| 32-48 GB | `Qwen/Qwen2.5-14B-Instruct` | Лучше качество, медленнее |
| 80 GB | `Qwen/Qwen2.5-32B-Instruct` | Хорошее качество, но тяжелее |

Для нашего parser-а лучше всего начать с:

```env
LLM_MODEL=Qwen/Qwen2.5-7B-Instruct
```

Если после запуска будет ошибка `CUDA out of memory`, перейти на:

```env
LLM_MODEL=Qwen/Qwen2.5-3B-Instruct
LLM_MAX_MODEL_LEN=4096
LLM_GPU_MEMORY_UTILIZATION=0.85
```

## 5. Установить Docker

Сначала проверь, есть ли Docker:

```bash
docker --version
docker compose version
```

Если команды работают, переходи к разделу 6.

### Вариант A: Ubuntu/Debian

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Добавь пользователя в группу Docker:

```bash
sudo usermod -aG docker $USER
```

Потом выйди и зайди по SSH заново:

```bash
exit
```

### Вариант B: Rocky/AlmaLinux/CentOS/RHEL

```bash
sudo dnf -y install dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

Потом выйди и зайди по SSH заново:

```bash
exit
```

После повторного входа проверь:

```bash
docker run hello-world
```

## 6. Установить NVIDIA Container Toolkit

Он нужен, чтобы Docker-контейнеры видели GPU.

### Ubuntu/Debian

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

### Rocky/AlmaLinux/CentOS/RHEL

```bash
curl -s -L https://nvidia.github.io/libnvidia-container/stable/rpm/nvidia-container-toolkit.repo | \
  sudo tee /etc/yum.repos.d/nvidia-container-toolkit.repo
sudo dnf install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

Проверь, что Docker видит GPU:

```bash
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
```

Если видишь таблицу GPU, всё хорошо.

## 7. Загрузить проект на сервер

Нужна папка проекта `tender1` на сервере.

### Вариант A: через Git

Если репозиторий есть на GitHub/GitLab:

```bash
git clone <URL_РЕПОЗИТОРИЯ> tender1
cd tender1
```

### Вариант B: через `scp` с Windows

Если Git-репозитория на сервере нет, с локального компьютера можно загрузить папку.

В PowerShell на Windows из папки `c:\Users\user\Desktop`:

```powershell
scp -r .\tender1 cloud-user@85.116.182.35:/home/cloud-user/tender1
```

Потом на сервере:

```bash
cd /home/cloud-user/tender1
```

## 8. Создать production `.env`

В папке проекта на сервере:

```bash
cp .env.production.example .env
```

Открой `.env`:

```bash
nano .env
```

Минимально проверь и выставь:

```env
POSTGRES_PASSWORD=change-this-password
RAG_POSTGRES_PASSWORD=change-this-rag-password

AI_PROVIDER=groq
GROQ_API_KEY=local-llm
GROQ_BASE_URL=http://llm:8000/v1
GROQ_API_BASE=http://llm:8000/v1
CHAT_MODEL=local-llm
SPEC_AI_PROVIDER=groq
SPEC_CHAT_MODEL=local-llm
GROQ_MODEL=local-llm

LLM_MODEL=Qwen/Qwen2.5-7B-Instruct
LLM_SERVED_MODEL=local-llm
LLM_MAX_MODEL_LEN=8192
LLM_GPU_MEMORY_UTILIZATION=0.90
LLM_EXTRA_ARGS=
LLM_PORT=8000

AI_LOT_FILTER_ENABLED=true
MAX_WORKERS=2
RAG_SPEC_AI_MAX_PER_CYCLE=10
```

Если GPU слабая или памяти меньше 20 GB, лучше так:

```env
LLM_MODEL=Qwen/Qwen2.5-3B-Instruct
LLM_MAX_MODEL_LEN=4096
LLM_GPU_MEMORY_UTILIZATION=0.85
MAX_WORKERS=2
```

Сохранить в `nano`:

```text
Ctrl+O
Enter
Ctrl+X
```

## 9. Запустить локальную модель

Из папки проекта:

```bash
docker compose -f docker-compose.prod.yml --env-file .env --profile llm up -d llm
```

Первый запуск будет долгим, потому что модель скачивается с Hugging Face.

Смотреть логи:

```bash
docker compose -f docker-compose.prod.yml --env-file .env logs -f llm
```

Дождись примерно такого смысла в логах:

```text
Uvicorn running on http://0.0.0.0:8000
```

Проверить API модели:

```bash
curl http://localhost:8000/v1/models
```

Должен появиться JSON со списком моделей и `local-llm`.

## 10. Проверить генерацию

Выполни:

```bash
curl http://localhost:8000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer local-llm' \
  -d '{"model":"local-llm","messages":[{"role":"user","content":"Ответь строго JSON: {\"ok\": true}"}],"temperature":0.1}'
```

Если вернулся ответ с `choices`, модель работает.

## 11. Запустить весь проект

Когда `llm` работает, запускай остальные сервисы:

```bash
docker compose -f docker-compose.prod.yml --env-file .env --profile llm up -d --build
```

Проверить контейнеры:

```bash
docker compose -f docker-compose.prod.yml --env-file .env ps
```

Смотреть логи parser-а:

```bash
docker compose -f docker-compose.prod.yml --env-file .env logs -f parser
```

Смотреть логи RAG:

```bash
docker compose -f docker-compose.prod.yml --env-file .env logs -f rag-api
```

Смотреть логи модели:

```bash
docker compose -f docker-compose.prod.yml --env-file .env logs -f llm
```

## 12. Как понять, что parser использует локальную модель

В `.env` должно быть:

```env
GROQ_API_BASE=http://llm:8000/v1
GROQ_MODEL=local-llm
GROQ_API_KEY=local-llm
```

Проверить переменные внутри parser:

```bash
docker compose -f docker-compose.prod.yml --env-file .env exec parser env | grep GROQ
```

Ожидаемо:

```text
GROQ_API_KEY=local-llm
GROQ_API_BASE=http://llm:8000/v1
GROQ_MODEL=local-llm
```

Проверить переменные внутри RAG:

```bash
docker compose -f docker-compose.prod.yml --env-file .env exec rag-api env | grep -E 'GROQ|CHAT_MODEL|SPEC'
```

Ожидаемо:

```text
GROQ_API_KEY=local-llm
GROQ_BASE_URL=http://llm:8000/v1
CHAT_MODEL=local-llm
SPEC_CHAT_MODEL=local-llm
SPEC_AI_PROVIDER=groq
```

## 13. Если ошибка CUDA out of memory

Останови сервис:

```bash
docker compose -f docker-compose.prod.yml --env-file .env stop llm
```

Открой `.env`:

```bash
nano .env
```

Поставь меньшую модель:

```env
LLM_MODEL=Qwen/Qwen2.5-3B-Instruct
LLM_MAX_MODEL_LEN=4096
LLM_GPU_MEMORY_UTILIZATION=0.85
```

Запусти заново:

```bash
docker compose -f docker-compose.prod.yml --env-file .env --profile llm up -d llm
```

## 14. Если модель отвечает плохим JSON

Для задач parser/RAG нужен JSON. Маленькие модели иногда портят формат.

Что делать:

- если есть VRAM, перейти с `3B` на `7B`;
- уменьшить параллельность parser-а:

```env
MAX_WORKERS=1
RAG_SPEC_AI_MAX_PER_CYCLE=5
```

- уменьшить контекст:

```env
LLM_MAX_MODEL_LEN=4096
```

## 15. Если всё зависло или непонятно

Проверить статус:

```bash
docker compose -f docker-compose.prod.yml --env-file .env ps
```

Посмотреть последние логи:

```bash
docker compose -f docker-compose.prod.yml --env-file .env logs --tail=100 llm
docker compose -f docker-compose.prod.yml --env-file .env logs --tail=100 parser
docker compose -f docker-compose.prod.yml --env-file .env logs --tail=100 rag-api
```

Проверить GPU:

```bash
nvidia-smi
```

Если модель занимает GPU, в `nvidia-smi` будет процесс Python/vLLM и занятая память.

## 16. Самый короткий план

Если всё уже установлено, коротко:

```bash
ssh cloud-user@85.116.182.35
cd /home/cloud-user/tender1
cp .env.production.example .env
nano .env
docker compose -f docker-compose.prod.yml --env-file .env --profile llm up -d --build
docker compose -f docker-compose.prod.yml --env-file .env logs -f llm
curl http://localhost:8000/v1/models
```

После этого parser и RAG будут использовать локальную open-source модель, а не внешний Groq API.
