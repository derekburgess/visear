# Visear Backend

## Configure RunPod

Select Severless and + New Endpoint.

Select GitHub Repo and select: `Partial-Transformations/visear_backend`

Use the main branch and leave Dockerfile path empty/defaulted to Dockerfile.

Select a 16GB+ GPU.

Set to 10 workers.

No need for any Active Workers during testing.

Update Idle Timeout to 30 seconds.

Under Container Configuration set HTTP Port to expose 5000 and increase Container Disk to 20GB.

Under Environment Variables add `HF_TOKEN`.
