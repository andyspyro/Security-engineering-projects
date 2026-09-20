"use strict";

function normalizeOrigin(value) {
  try {
    return new URL(String(value)).origin;
  } catch {
    return null;
  }
}

function createOriginPolicy({
  publicOrigin = "",
  allowedOrigins = ""
} = {}) {
  const configured = new Set(
    [
      publicOrigin,
      ...String(allowedOrigins || "")
        .split(",")
        .map((value) => value.trim())
    ]
      .map(normalizeOrigin)
      .filter(Boolean)
  );

  function isAllowed(origin, host) {
    if (!origin) {
      return true;
    }

    const normalized = normalizeOrigin(origin);
    if (!normalized) {
      return false;
    }

    if (configured.size > 0) {
      return configured.has(normalized);
    }

    try {
      return new URL(normalized).host === String(host || "");
    } catch {
      return false;
    }
  }

  function apiMiddleware(req, res, next) {
    const origin = req.get("origin");

    if (!origin) {
      return next();
    }

    if (!isAllowed(origin, req.get("host"))) {
      return res.status(403).json({
        error: {
          code: "ORIGIN_NOT_ALLOWED",
          message: "Request origin is not allowed."
        }
      });
    }

    const normalized = normalizeOrigin(origin);

    if (configured.has(normalized)) {
      res.setHeader("Access-Control-Allow-Origin", normalized);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");

      if (req.method === "OPTIONS") {
        res.setHeader(
          "Access-Control-Allow-Methods",
          "GET,POST,PATCH,DELETE,OPTIONS"
        );
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type,X-CSRF-Token"
        );
        return res.status(204).end();
      }
    }

    next();
  }

  return {
    configuredOrigins: configured,
    isAllowed,
    apiMiddleware
  };
}

module.exports = createOriginPolicy;
