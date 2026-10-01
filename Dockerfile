# ─────────────────────────────────────────────
#  Stage 1 – Build (nothing to compile for a
#  pure static site, just copy assets)
# ─────────────────────────────────────────────
FROM docker.io/library/nginx:1.27-alpine AS final

# Remove the default Nginx welcome page
RUN rm -rf /usr/share/nginx/html/*

# Copy the static site into the Nginx web root
COPY index.html /usr/share/nginx/html/index.html

# Use the official Nginx configuration, which serves files from
# /usr/share/nginx/html on port 80.
EXPOSE 80

# Nginx runs in the foreground
CMD ["nginx", "-g", "daemon off;"]
