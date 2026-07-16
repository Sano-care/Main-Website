package `in`.sanocare.pulse.data.auth

// PB1 — typed results so the ViewModels never touch raw Retrofit/Throwables.

sealed class AuthResult<out T> {
    data class Ok<T>(val value: T) : AuthResult<T>()
    data class Err(val message: String, val code: Int?) : AuthResult<Nothing>()
}

/** Outcome of an OTP verify on the patient app. */
sealed interface VerifyOutcome {
    /** OTP verified, bearer token minted + persisted. */
    data class Customer(val isNewCustomer: Boolean, val fullName: String?) : VerifyOutcome

    /** The number is registered as Sanocare staff (role="medic") — no patient
     *  session is created; the UI directs the user to the Medic app. */
    data object MedicNumber : VerifyOutcome

    data class Error(val message: String) : VerifyOutcome
}

/** Cached identity for the shell top bar on cold start. */
data class CachedCustomer(
    val customerId: String?,
    val fullName: String?,
)
