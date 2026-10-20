import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: "mail.ahmadiah.com",
  port: 587,
  secure: false,
  auth: {
    user: "pmv-platform@ahmadiah.com",
    pass: "ppfm@243",
  },
  tls: {
    servername: "mail.ahmadiah.com", // the name on the certificate, if that's the right hostname
    rejectUnauthorized: false,       // testing only
  },
  logger: true,
  debug: true,
});

transporter.sendMail({
  from: "pmv-platform@ahmadiah.com",
  to: "mmeh6315@gmail.com",
  subject: "SMTP Test",
  text: "SMTP is working!",
})
.then(info => {
  console.log("SUCCESS");
  console.log(info);
})
.catch(err => {
  console.error("ERROR");
  console.error(err);
});