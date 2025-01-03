import jwt from "jsonwebtoken";

jwt.sign(
  {
    token_type: "access",
    exp: 1734192799,
    iat: 1734106399,
    jti: "f49550f449e54df897f768c1bd55a2ab",
    user_id: 38262,
  },
  "secret",
  { algorithm: "none" },
  function (err, token) {
    console.log(token);
  },
);
